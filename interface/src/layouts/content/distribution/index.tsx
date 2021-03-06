import React, { RefObject, useContext, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";

import { scaleBand, scaleLinear } from "d3-scale";
import { select as d3Select } from "d3-selection";
import { axisBottom, axisLeft } from "d3-axis";

import { IAlphabet, IDataset } from "src/state/models";
import { ALPHABET_COLORS } from "src/constants";
import { isEmpty } from "src/utils";
import { AlphabetContext } from "src/state/stores/alphabet";

import styles from "./_distribution.module.scss";

type IData = {
  letter: string;
  actual: number;
  expected: number;
  diffRaw: number;
  percentDiff: number;
};

type IChartProps = {
  alphabet: IAlphabet;
  dataset: IDataset;
};

class ChartInfo {
  static SVGHeight = 145;
  static SVGWidth = 280;
  static margin = 30;
  static height = ChartInfo.SVGHeight - ChartInfo.margin;
  static width = ChartInfo.SVGWidth - ChartInfo.margin;
  static bounds: { top: number; bottom: number; left: number; right: number } = {
    top: 0 + ChartInfo.margin,
    bottom: ChartInfo.margin + ChartInfo.height,
    left: 0 + ChartInfo.margin,
    right: ChartInfo.margin + ChartInfo.width
  };
}

const buildChart = ({
  node,
  alphabet,
  dataset
}: IChartProps & { node: RefObject<SVGSVGElement> }) => {
  const [created, setCreated] = useState(false);

  useEffect(() => {
    if (node.current === null) throw new Error("Failed creating svg.");
    if (created || isEmpty(alphabet) || isEmpty(dataset)) {
      console.warn("Not charting graph yet... Alphabet/Data seems to be empty. ");
      return;
    }
    setCreated(true);

    const data = calculateData(alphabet, dataset);
    const fullAlphabet = new Set<string>([...Object.keys(alphabet), ".", "*"]);

    const dataMax = Math.max(...data.map((d) => d.percentDiff));
    const dataMin = Math.min(...data.map((d) => d.percentDiff));
    const maxScale = Math.max(Math.abs(dataMax), Math.abs(dataMin));

    const xScaleRaw = scaleBand()
      .domain(Array.from(fullAlphabet))
      .range([ChartInfo.bounds.left, ChartInfo.bounds.right])
      .padding(0.3);

    const yScaleRaw = scaleLinear()
      .domain([-maxScale, maxScale])
      .range([ChartInfo.bounds.bottom, ChartInfo.bounds.top]);

    const svg = d3Select(node.current);
    const chart = svg.append("g"); //.attr("transform", `translate(${Chart.margin}, ${Chart.margin})`);

    const yAxisRaw = axisLeft(yScaleRaw)
      .ticks(6)
      .tickSizeOuter(0);

    const yAxis = svg
      .append("g")
      .attr("transform", `translate(${ChartInfo.margin}, 0)`)
      .call(yAxisRaw);

    const bottomAxisRaw = axisBottom(xScaleRaw).tickSizeOuter(0);
    const bottomAxis = svg
      .append("g")
      .attr("transform", `translate(0, ${ChartInfo.bounds.bottom})`)
      .call(bottomAxisRaw);

    const zeroAxisRaw = axisBottom(xScaleRaw)
      .tickValues([])
      .tickSizeOuter(0);
    const zeroAxis = svg
      .append("g")
      .attr("transform", `translate(0, ${yScaleRaw(0)})`)
      .call(zeroAxisRaw);

    const bars = chart
      .selectAll("rect")
      .data(data)
      .enter()
      .append("rect")
      .attr("x", (d) => {
        const x = xScaleRaw(d.letter);
        if (x !== undefined) return x;
        console.log("RETURNING NULL X");
        return null;
      })
      .attr("y", (d) => {
        let y = yScaleRaw(d.percentDiff);
        if (d.percentDiff < 0) {
          y = yScaleRaw(0);
        }
        return y;
      })
      .attr("width", xScaleRaw.bandwidth())
      .attr("height", (d) => {
        const y = yScaleRaw(d.percentDiff);
        const y0 = yScaleRaw(0);

        return Math.abs(y - y0);
      })
      .attr("fill", (d) => ALPHABET_COLORS[d.letter]);
    // .on("mouseover", tip.show)
    // .on("mouseout", tip.hideModal);
  }, [alphabet, dataset]);
};

const calculateData = (alphabet: IAlphabet, dataset: IDataset) => {
  const out: IData[] = [];
  // const out: Array<{ [letter: string]: number }> = [];
  // TODO: Convert to set
  for (const letter of Object.keys(alphabet)) {
    const details = alphabet[letter];
    if (!details.freq) continue;

    // expectedRaw: 1200; expected: 0.075
    const expectedRaw = Math.round(details.freq * dataset.analysis.amino_count);

    const actualRaw = dataset.analysis.distribution[letter] || 0;
    const actual = actualRaw / dataset.analysis.amino_count;

    const diffRaw = actual - details.freq;
    const percentDiff = (diffRaw / details.freq) * 100;

    out.push({
      letter: letter,
      actual: Math.round(actual * 100) / 100,
      expected: details.freq,
      diffRaw: Math.round(diffRaw * 1000) / 1000,
      percentDiff: Math.round(percentDiff)
    });
    // out.push({ [letter]: percentDiff });
  }

  return out;
};

export const Distribution = observer<{ dataset: IDataset }>(({ dataset }) => {
  const alphabetStore = useContext(AlphabetContext);
  const node = useRef<SVGSVGElement>(null);
  buildChart({ node, alphabet: alphabetStore.alphabet, dataset });

  return (
    <svg
      className={styles.svg}
      ref={node}
      height={ChartInfo.SVGHeight + 35}
      width={ChartInfo.SVGWidth + 25}
    />
  );
});
