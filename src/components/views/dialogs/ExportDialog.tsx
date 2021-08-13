/*
Copyright 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, { useRef, useState } from "react";
import { Room } from "matrix-js-sdk/src";
import { _t } from "../../../languageHandler";
import { IDialogProps } from "./IDialogProps";
import BaseDialog from "./BaseDialog";
import DialogButtons from "../elements/DialogButtons";
import Field from "../elements/Field";
import StyledRadioGroup from "../elements/StyledRadioGroup";
import StyledCheckbox from "../elements/StyledCheckbox";
import {
    ExportFormat,
    ExportType,
    textForFormat,
    textForType,
} from "../../../utils/exportUtils/exportUtils";
import { IFieldState, IValidationResult } from "../elements/Validation";
import HTMLExporter from "../../../utils/exportUtils/HtmlExport";
import JSONExporter from "../../../utils/exportUtils/JSONExport";
import PlainTextExporter from "../../../utils/exportUtils/PlainTextExport";
import { useStateCallback } from "../../../hooks/useStateCallback";
import Exporter from "../../../utils/exportUtils/Exporter";
import Spinner from "../elements/Spinner";

interface IProps extends IDialogProps {
    room: Room;
}

const ExportDialog: React.FC<IProps> = ({ room, onFinished }) => {
    const [exportFormat, setExportFormat] = useState(ExportFormat.Html);
    const [exportType, setExportType] = useState(ExportType.Timeline);
    const [includeAttachments, setAttachments] = useState(false);
    const [isExporting, setExporting] = useState(false);
    const [numberOfMessages, setNumberOfMessages] = useState<number>(100);
    const [sizeLimit, setSizeLimit] = useState<number | null>(8);
    const sizeLimitRef = useRef<Field>();
    const messageCountRef = useRef<Field>();
    const exportProgressRef = useRef<HTMLParagraphElement>();
    const [displayCancel, setCancelWarning] = useState(false);
    const [exportCancelled, setExportCancelled] = useState(false);
    const [exportSuccessful, setExportSuccessful] = useState(false);
    const [Exporter, setExporter] = useStateCallback<Exporter>(
        null,
        async (exporter: Exporter) => {
            await exporter?.export().then(() => {
                if (!exportCancelled) setExportSuccessful(true);
            });
        },
    );

    const startExport = async () => {
        const exportOptions = {
            numberOfMessages,
            attachmentsIncluded: includeAttachments,
            maxSize: sizeLimit * 1024 * 1024,
        };
        switch (exportFormat) {
            case ExportFormat.Html:
                setExporter(
                    new HTMLExporter(
                        room,
                        ExportType[exportType],
                        exportOptions,
                        exportProgressRef,
                    ),
                );
                break;
            case ExportFormat.Json:
                setExporter(
                    new JSONExporter(
                        room,
                        ExportType[exportType],
                        exportOptions,
                        exportProgressRef,
                    ),
                );
                break;
            case ExportFormat.PlainText:
                setExporter(
                    new PlainTextExporter(
                        room,
                        ExportType[exportType],
                        exportOptions,
                        exportProgressRef,
                    ),
                );
                break;
            default:
                console.error("Unknown export format");
                return;
        }
    };

    const onExportClick = async () => {
        const isValidSize = await sizeLimitRef.current.validate({
            focused: false,
        });
        if (!isValidSize) {
            sizeLimitRef.current.validate({ focused: true });
            return;
        }
        if (exportType === ExportType.LastNMessages) {
            const isValidNumberOfMessages =
                await messageCountRef.current.validate({ focused: false });
            if (!isValidNumberOfMessages) {
                messageCountRef.current.validate({ focused: true });
                return;
            }
        }
        setExporting(true);
        await startExport();
    };

    const onValidateSize = async ({
        value,
    }: Pick<IFieldState, "value">): Promise<IValidationResult> => {
        const parsedSize = parseFloat(value);
        const min = 1;
        const max = 2000;

        if (isNaN(parsedSize)) {
            return { valid: false, feedback: _t("Size must be a number") };
        }

        if (min > parsedSize || parsedSize > max) {
            return {
                valid: false,
                feedback: _t(
                    "Size can only be between %(min)s MB and %(max)s MB",
                    { min, max },
                ),
            };
        }

        return {
            valid: true,
            feedback: _t("Enter size between %(min)s MB and %(max)s MB", {
                min,
                max,
            }),
        };
    };

    const onValidateNumberOfMessages = async ({
        value,
    }: Pick<IFieldState, "value">): Promise<IValidationResult> => {
        const parsedSize = parseFloat(value);
        const min = 1;
        const max = 10 ** 8;

        if (isNaN(parsedSize)) {
            return {
                valid: false,
                feedback: _t("Number of messages must be a number"),
            };
        }

        if (min > parsedSize || parsedSize > max) {
            return {
                valid: false,
                feedback: _t(
                    "Number of messages can only be between %(min)s and %(max)s",
                    { min, max },
                ),
            };
        }

        return {
            valid: true,
            feedback: _t("Enter a number between %(min)s and %(max)s", {
                min,
                max,
            }),
        };
    };

    const onCancel = async () => {
        if (isExporting) setCancelWarning(true);
        else onFinished(false);
    };

    const confirmCanel = async () => {
        await Exporter?.cancelExport().then(() => {
            setExportCancelled(true);
            setExporting(false);
            setExporter(null);
        });
    };

    const exportFormatOptions = Object.keys(ExportFormat).map((format) => ({
        value: format,
        label: textForFormat(format),
    }));

    const exportTypeOptions = Object.keys(ExportType).map((type) => {
        return (
            <option key={type} value={type}>
                { textForType(type) }
            </option>
        );
    });

    let messageCount = null;
    if (exportType === ExportType.LastNMessages) {
        messageCount = (
            <Field
                element="input"
                type="number"
                value={numberOfMessages.toString()}
                ref={messageCountRef}
                onValidate={onValidateNumberOfMessages}
                label={_t("Number of messages")}
                onChange={(e) => {
                    setNumberOfMessages(parseInt(e.target.value));
                }}
            />
        );
    }

    const sizePostFix = <span>{ _t("MB") }</span>;

    if (exportCancelled) {
        // Display successful cancellation message
        return (
            <BaseDialog
                title={_t("Export Cancelled")}
                className="mx_ExportDialog"
                contentId="mx_Dialog_content"
                onFinished={onFinished}
                fixedWidth={true}
            >
                <p>{ _t("The export was cancelled successfully") }</p>

                <DialogButtons
                    primaryButton={_t("Okay")}
                    hasCancel={false}
                    onPrimaryButtonClick={onFinished}
                />
            </BaseDialog>
        );
    } else if (exportSuccessful) {
        // Display successful export message
        return (
            <BaseDialog
                title={_t("Export Successful")}
                className="mx_ExportDialog"
                contentId="mx_Dialog_content"
                onFinished={onFinished}
                fixedWidth={true}
            >
                <p>{ _t("Your messages were successfully exported") }</p>

                <DialogButtons
                    primaryButton={_t("Okay")}
                    hasCancel={false}
                    onPrimaryButtonClick={onFinished}
                />
            </BaseDialog>
        );
    } else if (displayCancel) {
        // Display cancel warning
        return (
            <BaseDialog
                title={_t("Warning")}
                className="mx_ExportDialog"
                contentId="mx_Dialog_content"
                onFinished={onFinished}
                fixedWidth={true}
            >
                <p>
                    { _t(
                        "Are you sure you want to stop exporting your data? If you do, you'll need to start over.",
                    ) }
                </p>
                <DialogButtons
                    primaryButton={_t("Stop")}
                    primaryButtonClass="danger"
                    hasCancel={true}
                    cancelButton={_t("Continue")}
                    onCancel={() => setCancelWarning(false)}
                    onPrimaryButtonClick={confirmCanel}
                />
            </BaseDialog>
        );
    } else {
        // Display export settings
        return (
            <BaseDialog
                title={isExporting ? _t("Exporting your data") : _t("Export Chat")}
                className={`mx_ExportDialog ${isExporting && "mx_ExportDialog_Exporting"}`}
                contentId="mx_Dialog_content"
                hasCancel={true}
                onFinished={onFinished}
                fixedWidth={true}
            >
                { !isExporting ? <p>
                    { _t(
                        "Select from the options below to export chats from your timeline",
                    ) }
                </p> : null }

                <span className="mx_ExportDialog_subheading">
                    { _t("Format") }
                </span>

                <div className="mx_ExportDialog_options">
                    <StyledRadioGroup
                        name="exportFormat"
                        value={exportFormat}
                        onChange={(key) => setExportFormat(ExportFormat[key])}
                        definitions={exportFormatOptions}
                    />

                    <span className="mx_ExportDialog_subheading">
                        { _t("Messages") }
                    </span>

                    <Field
                        element="select"
                        value={exportType}
                        onChange={(e) => {
                            setExportType(ExportType[e.target.value]);
                        }}
                    >
                        { exportTypeOptions }
                    </Field>
                    { messageCount }

                    <span className="mx_ExportDialog_subheading">
                        { _t("Size Limit") }
                    </span>

                    <Field
                        type="number"
                        autoComplete="off"
                        onValidate={onValidateSize}
                        element="input"
                        ref={sizeLimitRef}
                        value={sizeLimit.toString()}
                        postfixComponent={sizePostFix}
                        onChange={(e) => setSizeLimit(parseInt(e.target.value))}
                    />

                    <StyledCheckbox
                        checked={includeAttachments}
                        onChange={(e) =>
                            setAttachments(
                                (e.target as HTMLInputElement).checked,
                            )
                        }
                    >
                        { _t("Include Attachments") }
                    </StyledCheckbox>
                </div>
                { isExporting ? (
                    <div className="mx_ExportDialog_progress">
                        <Spinner w={24} h={24} />
                        <p ref={exportProgressRef}>
                            { _t("Processing...") }
                        </p>
                        <DialogButtons
                            primaryButton={_t("Cancel")}
                            primaryButtonClass="danger"
                            hasCancel={false}
                            onPrimaryButtonClick={onCancel}
                        />
                    </div>
                ) : (
                    <DialogButtons
                        primaryButton={_t("Export")}
                        onPrimaryButtonClick={onExportClick}
                        onCancel={() => onFinished(false)}
                    />
                ) }
            </BaseDialog>
        );
    }
};

export default ExportDialog;
