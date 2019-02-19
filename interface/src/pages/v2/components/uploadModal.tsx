import React, { PureComponent } from "react";
import { FiEdit, FiX } from "react-icons/fi";
import { connect } from "react-redux";

import styles from "./_UploadModal.module.scss";
import Modal from "src/components/modal";
import { IAppState, IDispatchProps } from "src/state/models";
import * as actions from "src/state/actions";
import FileUpload from "src/pages/v2/components/fileUpload";

type IUploadModalProps = {
  visible: boolean;
};

type IUploadFields = {
  nameInput: HTMLInputElement | null;
  fileInput: FileUpload | null;
};

class UploadModal extends PureComponent<IUploadModalProps & IDispatchProps> {
  fields: IUploadFields = {
    nameInput: null,
    fileInput: null
  };

  _keyCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // catch escape
    if (event.keyCode === 27) {
      event.stopPropagation();
      this._closeModal();
    }
  };
  componentWillMount() {
    // @ts-ignore
    document.addEventListener("keydown", this._keyCapture, false);
  }
  componentWillUnmount() {
    // @ts-ignore
    document.removeEventListener("keydown", this._keyCapture, false);
  }

  _resetForm = () => {
    for (const field of Object.values(this.fields)) {
      if (field !== null) {
        field.value = "";
      }
    }
  };

  _areFieldsModified = (): boolean => {
    for (const field of Object.values(this.fields)) {
      if (field !== null) {
        if (field.value !== "") return true;
      }
    }
    return false;
  };

  _closeModal = () => {
    const { dispatch } = this.props;

    if (!this._areFieldsModified() || window.confirm("Changes you made may not be saved.")) {
      dispatch(actions.setModal({ modalID: modalIDs.upload, status: false }));
    }
  };

  _submitForm = () => {};

  render() {
    const { visible, dispatch } = this.props;
    return (
      <Modal visible={visible}>
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.headerContent}>
              <input
                className={styles.nameInput}
                type="text"
                placeholder="Dataset name... "
                ref={(inp) => (this.fields.nameInput = inp)}
              />
              <FiEdit
                className={styles.nameInputIcon}
                onClick={() => {
                  if (this.fields.nameInput !== null) {
                    this.fields.nameInput.focus();
                    this.fields.nameInput.select();
                  }
                }}
              />
            </div>

            <div className={styles.headerRight}>
              <button className={styles.formReset} onClick={this._resetForm}>
                Reset Form
              </button>
              <FiX className={styles.closeIcon} onClick={this._closeModal} />
            </div>
          </div>

          <div className={styles.content}>
            <div className={styles.contentBody}>
              <FileUpload ref={(inp) => (this.fields.fileInput = inp)} />
            </div>

            <hr />
            <button className={styles.submitButton}>Submit</button>
          </div>
        </div>
      </Modal>
    );
  }
}

export default connect<IUploadModalProps, IDispatchProps, {}, IAppState>(
  (state: IAppState) => ({
    visible: state.upload.upload
  }),
  (dispatch) => ({
    dispatch: dispatch
  })
)(UploadModal);
