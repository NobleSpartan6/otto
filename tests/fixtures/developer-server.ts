// Only the protocol test launches this synthetic driver. The production CLI has no fixture flag.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createDeveloperServer,
  type InspectionDriver,
} from "../../desktop/developer-server.js";
import type { NativeSnapshot } from "../../shared/types.js";

let configured: string[] = [];
let active = false;
let sequence = 0;
const driver: InspectionDriver = {
  async configure(appIds) {
    configured = appIds;
  },
  async apps() {
    return {
      apps: [
        { id: "fixture", name: "Fixture", pid: 123 },
        { id: "unselected", name: "Unselected private app", pid: 456 },
      ],
      permissions: {
        accessibility: true,
        screenCapture: true,
        platform: "fixture",
      },
    };
  },
  async observe(appId): Promise<NativeSnapshot> {
    if (!configured.includes(appId)) throw new Error("Wrong app observed.");
    if (active) throw new Error("Concurrent native observations.");
    if (appId === "broken")
      throw new Error("Private native details must not leave this process.");
    active = true;
    await new Promise((resolve) => setTimeout(resolve, 40));
    active = false;
    return {
      snapshotId: `private-native-snapshot-${++sequence}`,
      app: {
        id: appId === "mismatch" ? "unselected" : appId,
        name: "Fixture",
        pid: 123,
      },
      title: "Fixture form",
      text: "Name and city",
      capturedAt: new Date().toISOString(),
      screenshot: "data:image/jpeg;base64,SECRET_SCREENSHOT_BYTES",
      controls: [
        {
          id: "private-native-element-1",
          role: "Edit",
          label: "Name",
          value: "",
          enabled: true,
          editable: true,
          source: "accessibility",
          actions: ["fill"],
        },
        {
          id: "private-native-element-2",
          role: "Edit",
          label: "Password",
          value: "sensitive-marker",
          enabled: true,
          editable: true,
          sensitive: true,
          source: "accessibility",
          actions: ["fill"],
        },
        {
          id: "private-native-element-3",
          role: "Text",
          label: "City",
          enabled: true,
          source: "ocr",
          actions: ["press"],
        },
      ],
    };
  },
  cancel() {
    configured = [];
  },
};
const { server, stop } = await createDeveloperServer(driver, [
  "fixture",
  "broken",
  "mismatch",
]);
process.stdin.once("end", () => {
  stop();
  void server.close();
});
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 128 * 1024,
  }),
);
