import re

import pymongo
from flask import g
from Bio import SeqIO
from datetime import datetime
from collections import Counter

from pymongo import MongoClient
from pymongo.errors import BulkWriteError
from bson.objectid import ObjectId

from data import utils, models


class DataEngine:
    mongo_db_name = "sequencing"
    datasets_cname = "datasets"
    queries_cname = "queries"
    dataset_projection = {
        "name": 1,
        "data_format": 1,
        "user_filename": 1,
        "upload_time": 1,
        "analysis": 1,
        "queries": 1,
    }

    sequences_projection = {
        "seq_id": 1,
        "description": 1,
        "sequence": 1,
        "discarded": 1,
        "analysis": 1,
        "queries": 1,
    }

    def __init__(self):
        self.client = MongoClient(
            "mongodb://localhost:27017/",
            username="myuser",
            password="mypass",
            authSource="admin",
            socketTimeoutMS=3000,
            connectTimeoutMS=3000,
        )

        self.db = self.client.get_database(DataEngine.mongo_db_name)
        self._datasets = self.db.get_collection(DataEngine.datasets_cname)
        self._queries = self.db.get_collection(DataEngine.queries_cname)

    def gen_dataset_id(self):
        dataset_id = ObjectId()
        while str(dataset_id) in self.db.collection_names():
            dataset_id = ObjectId()

        return dataset_id

    def get_datasets(self, page=0, page_size=100):
        # offset = page * page_size
        cursor = self._datasets.find(
            {}, {"queries": 0}
        )  # .skip(offset).limit(page_size)
        return list(cursor)

    def get_dataset_records(
        self, dataset_id, page, page_size, qid=None, desc_filter=None
    ):
        records_cname = str(dataset_id)
        records_collection = self.db.get_collection(records_cname)

        mongo_filter = {}
        # projection = {"queries": 0}
        projection = {**DataEngine.sequences_projection}
        projection.pop("queries")
        if qid is not None:
            dataset = self._datasets.find_one({"_id": dataset_id})
            if not dataset["queries"].get(str(qid), None):
                query = self._queries.find_one({"_id": qid})
                self._build_query_for_dataset(query, dataset)
            mongo_filter[f"queries.{qid}"] = {"$exists": True}
            projection[f"queries.{str(qid)}"] = 1
        if desc_filter is not None:
            mongo_filter["$text"] = {"$search": f"{desc_filter}"}
            # projection["description"] = {"$meta": "textScore"}

        offset = page * page_size
        cursor = (
            records_collection.find(mongo_filter, projection)
            .skip(offset)
            .limit(page_size)
        )  # .sort("seq_id", 1)
        items = list(cursor)
        return {
            "page": page,
            "page_size": page_size,
            "items": items,
            "total_count": cursor.count(),
        }

    def delete_dataset(self, dataset_id):
        dataset = self._datasets.find_one_and_delete({"_id": dataset_id})
        self.db.drop_collection(str(dataset_id))
        return dataset

    def _create_and_insert_records(self, records_cname, records_iterator):
        records_collection = self.db.get_collection(records_cname)
        records_collection.create_index([("description", pymongo.TEXT)])
        analysis = {
            "discarded_count": 0,
            "record_count": 0,
            "amino_count": 0,
            "distribution": Counter(),
        }

        with utils.BulkWriter(records_collection.insert_many) as bw:
            for raw_record in records_iterator:
                record = utils.convert_raw_record(raw_record)
                bw.insert(utils.convert_model(record))

                if record.discarded or not record.analysis:
                    analysis["discarded_count"] += 1
                    continue
                else:
                    analysis["record_count"] += 1
                    analysis["amino_count"] += record.analysis.amino_count
                    analysis["distribution"] += record.analysis.distribution

        return analysis

    def create_dataset(self, name, data_format, user_filename, path):
        dataset_id = self.gen_dataset_id()
        dataset = models.Dataset(
            _id=dataset_id,
            name=name,
            data_format=data_format,
            user_filename=user_filename,
            upload_time=datetime.utcnow(),
        )

        records_cname = str(dataset_id)

        records_iterator = SeqIO.parse(path, data_format)
        analysis = self._create_and_insert_records(records_cname, records_iterator)

        errors = []
        if analysis["record_count"] == 0:
            self.db.drop_collection(records_cname)

            errors.append("no_valid_records")
            dataset = None
        else:
            dataset.analysis = models.DatasetAnalysis(**analysis)
            dataset.queries = {}
            self._datasets.insert_one(utils.convert_model(dataset))

        return errors, dataset

    def get_queries(self):
        return list(self._queries.find())

    def build_query(self, raw_pattern):
        raw_pattern = raw_pattern.upper()
        raw_pattern_re = utils.compile_regex(raw_pattern)
        if raw_pattern_re is None:
            return None, ["invalid_pattern"]
        pattern = utils.convert_raw_pattern(raw_pattern)
        pattern_re = utils.compile_regex(pattern)
        if pattern_re is None:
            return None, ["failure_converting_pattern"]

        preexisting = self._queries.find_one({"pattern": pattern})
        if preexisting is not None:
            return preexisting, ["duplicate_pattern"]

        query = models.Query(raw_pattern=raw_pattern, pattern=pattern)
        query_out = utils.convert_model(query)
        inserted = self._queries.insert_one(query_out)
        return query_out, []

    def _build_query_for_dataset(self, query, dataset):
        query_re = utils.compile_regex(query["pattern"])
        records_cname = str(dataset["_id"])
        records = self.db.get_collection(records_cname)
        total_matches = 0

        with utils.BulkWriter(records.bulk_write) as bw:
            for record in records.find():
                matches = utils.get_sequence_matches(query_re, record["sequence"])

                if len(matches) > 0:
                    total_matches += len(matches)
                    bw.insert(
                        pymongo.UpdateOne(
                            {"_id": record["_id"]},
                            {"$set": {f"queries.{query['_id']}": {"matches": matches}}},
                        )
                    )
        self._datasets.update_one(
            {"_id": dataset["_id"]},
            {"$set": {f"queries.{query['_id']}": {"total_matches": total_matches}}},
        )

        return total_matches

    def query_dataset(self, query_id, dataset_id):
        query = self._queries.find_one({"_id": query_id})
        dataset = self._datasets.find_one({"_id": dataset_id})

        errors = []
        if query is None:
            errors.append("invalid_query")
        if dataset is None:
            errors.append("invalid_dataset")
        if len(errors) > 0:
            return errors

        # total matches
        cached_match_analysis = dataset["queries"].get(query_id, None)
        if cached_match_analysis is None:
            cached_match_analysis = self._build_query_for_dataset(query, dataset)

        return cached_match_analysis

    # def query_dataset_sequences(self, query_id, dataset_id, page, page_size):
    #     query = self._queries.find_one({"_id": query_id})
    #     dataset = self._datasets.find_one({"_id": dataset_id})
    #
    #     errors = []
    #     if not query:
    #         errors.append("invalid_query")
    #     if not dataset:
    #         errors.append("invalid_dataset")
    #     if len(errors) > 0:
    #         return {"errors": errors}
    #
    #     if not dataset["queries"].get(str(query_id), None):
    #         self._build_query_for_dataset(query, dataset)
    #
    #     records_collection = self.db.get_collection(str(dataset_id))
    #     # total matches
    #     offset = page * page_size
    #     cursor = (
    #         records_collection.find({f"queries.{query_id}": {"$exists": True}})
    #         .skip(offset)
    #         .limit(page_size)
    #     )  # .sort("seq_id", 1)
    #     items = list(cursor)
    #     return {"page": page, "page_size": page_size, "items": items, "errors": []}


def get_engine():
    if not hasattr(g, "de"):
        g.de = DataEngine()
    return g.de


def close_de():
    de = g.pop("de", None)
    if de is not None:
        de.close()
