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

import { IContent, MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import { textForFormat, IExportOptions, ExportType } from "../../src/utils/exportUtils/exportUtils";
import '../skinned-sdk';
import PlainTextExporter from "../../src/utils/exportUtils/PlainTextExport";
import HTMLExporter from "../../src/utils/exportUtils/HtmlExport";
import * as TestUtilsMatrix from '../test-utils';
import { stubClient } from '../test-utils';
import { renderToString } from "react-dom/server";

let client: MatrixClient;

const MY_USER_ID = "@me:here";

function generateRoomId() {
    return '!' + Math.random().toString().slice(2, 10) + ':domain';
}

interface ITestContent extends IContent {
    expectedText: string;
}

describe('export', function() {
    stubClient();
    client = MatrixClientPeg.get();
    client.getUserId = () => {
        return MY_USER_ID;
    };

    const mockExportOptions: IExportOptions = {
        numberOfMessages: 5,
        maxSize: 100 * 1024 * 1024,
        attachmentsIncluded: false,
    };

    const invalidExportOptions: IExportOptions[] = [
        {
            numberOfMessages: 10**9,
            maxSize: 1024 * 1024 * 1024,
            attachmentsIncluded: false,
        },
        {
            numberOfMessages: -1,
            maxSize: 4096 * 1024 * 1024,
            attachmentsIncluded: false,
        },
        {
            numberOfMessages: 0,
            maxSize: 0,
            attachmentsIncluded: false,
        },
    ];

    function createRoom() {
        const room = new Room(generateRoomId(), null, client.getUserId());
        return room;
    }
    const mockRoom = createRoom();

    function mkEvents() {
        const matrixEvents = [];
        const ts0 = Date.now();
        let i: number;
        // plain text
        for (i = 0; i < 10; i++) {
            matrixEvents.push(TestUtilsMatrix.mkMessage({
                event: true, room: "!room:id", user: "@user:id",
                ts: ts0 + i * 1000,
            }));
        }
        // reply events
        for (i = 0; i < 10; i++) {
            matrixEvents.push(TestUtilsMatrix.mkEvent({
                "content": {
                    "body": "> <@me:here> Hi\n\nTest",
                    "format": "org.matrix.custom.html",
                    "m.relates_to": {
                        "m.in_reply_to": {
                            "event_id": "$" + Math.random() + "-" + Math.random(),
                        },
                    },
                    "msgtype": "m.text",
                },
                "user": "@me:here",
                "type": "m.room.message",
                "room": mockRoom.roomId,
                "event": true,
            }));
        }
        // membership events
        for (i = 0; i < 10; i++) {
            matrixEvents.push(TestUtilsMatrix.mkMembership({
                event: true, room: "!room:id", user: "@user:id",
                target: {
                    userId: "@user:id",
                    name: "Bob",
                    getAvatarUrl: () => {
                        return "avatar.jpeg";
                    },
                    getMxcAvatarUrl: () => 'mxc://avatar.url/image.png',
                },
                ts: ts0 + i*1000,
                mship: 'join',
                prevMship: 'join',
                name: 'A user',
            }));
        }
        // emote
        matrixEvents.push(TestUtilsMatrix.mkEvent({
            "content": {
                "body": "waves",
                "msgtype": "m.emote",
            },
            "user": "@me:here",
            "type": "m.room.message",
            "room": mockRoom.roomId,
            "event": true,
        }));
        // redacted events
        for (i = 0; i < 10; i++) {
            matrixEvents.push(new MatrixEvent({
                type: "m.room.message",
                sender: MY_USER_ID,
                content: {},
                unsigned: {
                    "age": 72,
                    "transaction_id": "m1212121212.23",
                    "redacted_because": {
                        "content": {},
                        "origin_server_ts": ts0 + i*1000,
                        "redacts": "$9999999999999999999999999999999999999999998",
                        "sender": "@me:here",
                        "type": "m.room.redaction",
                        "unsigned": {
                            "age": 94,
                            "transaction_id": "m1111111111.1",
                        },
                        "event_id": "$9999999999999999999999999999999999999999998",
                        "room_id": mockRoom.roomId,
                    },
                },
                event_id: "$9999999999999999999999999999999999999999999",
                room_id: mockRoom.roomId,
            }));
        }
        return matrixEvents;
    }

    const events: MatrixEvent[] = mkEvents();

    it('checks if the export format is valid', function() {
        expect(textForFormat('HTML')).toBeTruthy();
        expect(textForFormat('JSON')).toBeTruthy();
        expect(textForFormat('PLAIN_TEXT')).toBeTruthy();
        try {
            textForFormat('PDF');
            throw new Error("Expected to throw an error");
        } catch (e) {
            expect(e.message).toBe("Unknown format");
        }
    });

    it('checks if the export options are valid', function() {
        for (const exportOption of invalidExportOptions) {
            try {
                new PlainTextExporter(mockRoom, ExportType.Beginning, exportOption, null);
                throw new Error("Expected to throw an error");
            } catch (e) {
                expect(e.message).toBe("Invalid export options");
            }
        }
    });

    it('tests the file extension splitter', function() {
        const exporter = new PlainTextExporter(mockRoom, ExportType.Beginning, mockExportOptions, null);
        const fileNameWithExtensions = {
            "": ["", ""],
            "name": ["name", ""],
            "name.txt": ["name", ".txt"],
            ".htpasswd": ["", ".htpasswd"],
            "name.with.many.dots.myext": ["name.with.many.dots", ".myext"],
        };
        for (const fileName in fileNameWithExtensions) {
            expect(exporter.splitFileName(fileName)).toStrictEqual(fileNameWithExtensions[fileName]);
        }
    });

    it('checks if the reply regex executes correctly', function() {
        const eventContents: ITestContent[] = [
            {
                "msgtype": "m.text",
                "body": "> <@me:here> Source\n\nReply",
                "expectedText": "<@me:here \"Source\"> Reply",
            },
            {
                "msgtype": "m.text",
                // if the reply format is invalid, then return the body
                "body": "Invalid reply format",
                "expectedText": "Invalid reply format",
            },
            {
                "msgtype": "m.text",
                "body": "> <@me:here> The source is more than 32 characters\n\nReply",
                "expectedText": "<@me:here \"The source is more than 32 chara...\"> Reply",
            },
            {
                "msgtype": "m.text",
                "body": "> <@me:here> This\nsource\nhas\nnew\nlines\n\nReply",
                "expectedText": "<@me:here \"This\"> Reply",
            },
        ];
        const exporter = new PlainTextExporter(mockRoom, ExportType.Beginning, mockExportOptions, null);
        for (const content of eventContents) {
            expect(exporter.textForReplyEvent(content)).toBe(content.expectedText);
        }
    });

    it("checks if the render to string doesn't throw any error for different types of events", function() {
        const exporter = new HTMLExporter(mockRoom, ExportType.Beginning, mockExportOptions, null);
        for (const event of events) {
            expect(renderToString(exporter.getEventTile(event, false))).toBeTruthy();
        }
    });
});

