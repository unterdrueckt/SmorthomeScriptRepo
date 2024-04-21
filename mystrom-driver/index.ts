// ----------------------------------------------------------
// ---- Scroll down to default code format and examples! ----
// ----------------------------------------------------------
// @ts-ignore
import { parentPort, isMainThread, workerData } from "worker_threads";

interface Feature {
  _id: string;
  name: string;
  category: "sensor" | "action";
  verifyvalue: string;
  disable?: boolean;
  types: string[];
  unit?: string;
  icon?: string;
}

interface DeviceConfiguration {
  ip?: string;
  pollrate?: string;
  brokerUrl?: string;
  topics?: string[];
  username?: string;
  password?: string;
  // Additional properties specific to each configuration
  [key: string]: any;
}

interface DevicePerms {
  owner: string[];
  canuse: string[];
  readonly: string[];
}

interface DeviceDocument {
  _id: string;
  name: string;
  icon: string;
  conf: DeviceConfiguration;
  perms: DevicePerms;
  features: Feature[];
  // Additional properties specific to each device
  deviceType?: string;
  location?: string;
  roomId?: string;
  manufacturer?: string;
  deviceModel?: string;
  firmwareVersion?: string;
  isOnline?: boolean;
  installationDate?: Date;
  disable?: boolean;
  createdAt?: Date;
  deletedAt?: Date | null;
  driver: string;
}

interface RedisDocument {
  feature: {
    [key: string]: any;
  };
  status: string;
}

// ----------------------------------------------------------
// ----------------- Device connection code -----------------
// ----------------------------------------------------------

let ip_addr: string | undefined;
let temperatureId: string | undefined;
let powerId: string | undefined;
let switchId: string | undefined;
let switchValue: boolean | undefined;
let deviceDisabled: boolean = false;
let oldTemperatureValue: number = 0;
let oldWsValue: number = 0;

// default Interval 30s
let requestInterval: number = 30000;

// Server dominate device default: true
let serverDominateDevice: boolean = true;

/**
 * Finds the ID of a feature by its type.
 *
 * This function searches through an array of features and finds the feature with the specified type.
 *
 * @param features - An array of Features to search through.
 * @param type - The type of the feature to find.
 * @returns The ID of the found feature, or an empty string if no matching feature is found.
 */
function findFeatureId(features: Feature[], type: string): string {
  const feature = features.find((feature) => feature.types.includes(type));
  return feature ? feature._id : "";
}

function getKeys(device: DeviceDocument) {
  temperatureId = findFeatureId(device.features, "temperature");
  powerId = findFeatureId(device.features, "power");
  switchId = findFeatureId(device.features, "switch");
}

async function getInfo(device: DeviceDocument) {
  const ip = device.conf.ip;

  // Check and set requestInterval conf
  const tempRequestInterval = device.conf.requestInterval;
  if (typeof tempRequestInterval === "string") {
    requestInterval = parseInt(tempRequestInterval);
  }
  if (typeof tempRequestInterval === "number") {
    requestInterval = tempRequestInterval;
  }

  // Check if value is under 1000 or above 120000 and set to 30000
  if (requestInterval < 1000 || requestInterval > 120000) {
    console.log(
      "Reset requestInterval to 30s due to value being over 120s or under 1s."
    );
    requestInterval = 30000;
  }

  // Check device conf if serverDominateDevice is set
  const tempServerDominateDevice = device.conf.serverDominateDevice;
  if (typeof tempServerDominateDevice === "boolean") {
    serverDominateDevice = tempServerDominateDevice;
  }
  if (typeof tempServerDominateDevice === "string") {
    serverDominateDevice = tempServerDominateDevice !== "false";
  }

  try {
    const response = await fetch(`http://${ip}/info`);
    if (!response.ok) {
      console.log("Request failed");
      return;
    }
    const data = await response.json();

    parentPort?.postMessage({
      type: "editDevice",
      update: {
        conf: {
          ip: data.ip,
          requestInterval: requestInterval,
          serverDominateDevice: serverDominateDevice,
        },
        mac: data.mac,
        ip: data.ip,
        firmwareVersion: data.version,
        deviceModel: data.name || data.type,
      },
      preventRestart: true,
    });
  } catch (error) {
    parentPort?.postMessage({
      type: "setData",
      options: { status: "offline" },
    });
  }
}

async function fetchData() {
  if (deviceDisabled || !ip_addr) {
    return;
  }
  try {
    const response = await fetch(`http://${ip_addr}/report`);
    if (!response.ok) {
      console.log("Request failed");
      return;
    }
    const data = await response.json();

    const wsValue = data.Ws;
    const temperatureValue = data.temperature;
    const relayValue = data.relay;

    const wsDelta = Math.abs(oldWsValue - wsValue);
    if (wsDelta > 1) {
      oldWsValue = wsValue;
    } else if (wsDelta != 0) {
      parentPort?.postMessage({
        type: "setData",
        storeInDB: false,
        options: {
          feature: {
            [powerId!]: wsValue,
          },
        },
      });
    }

    // Check if delta is bigger that 0.6 due to mystrom messurement bug unstable by 0.6deg
    const tempDelta = Math.abs(oldTemperatureValue - temperatureValue);
    if (tempDelta > 0.6) {
      oldTemperatureValue = temperatureValue;
    }

    if (switchValue != relayValue && serverDominateDevice) {
      sendRelay(ip_addr, switchValue);
    } else {
      switchValue = relayValue;
    }

    parentPort?.postMessage({
      type: "setData",
      options: {
        feature: {
          [temperatureId!]: oldTemperatureValue,
          ...(wsDelta > 1 ? { [powerId!]: oldWsValue } : {}),
          [switchId!]: switchValue,
        },
        status: "online",
      },
    });
  } catch (error) {
    parentPort?.postMessage({
      type: "setData",
      options: { status: "offline" },
    });
  }
}

async function sendRelay(ip: string, state: boolean | undefined = switchValue) {
  if (deviceDisabled) {
    return;
  }
  try {
    const response = await fetch(
      `http://${ip}/relay?state=${state ? "1" : "0"}`
    );
    if (!response.ok) {
      parentPort?.postMessage({
        type: "setData",
        options: { status: "error" },
      });
    }
  } catch (error) {
    console.log(error);
    parentPort?.postMessage({
      type: "setData",
      options: { status: "offline" },
    });
  }
}

// ----------------------------------------------------------
// ----------           < MAIN PROCESS >           ----------
// ----------------------------------------------------------

if (!isMainThread) {
  /**
   * Main process event handler for a device driver.
   *
   * This code listens for incoming messages and responds based on the message type:
   * - If the initial message type is 'init', it checks if the device is in searching mode or not.
   *   - If searching, it sets up a listener for MQTT messages using 'handleSearchingMqttMessage'.
   *   - If not searching, it sets the device status to 'online' and listens for both MQTT and Redis messages.
   *
   * @param message - The incoming message from the parent process.
   */
  parentPort.on("message", async (message) => {
    switch (message?.type) {
      case "init":
        let device = message.device;

        deviceDisabled = device.disable;

        // get keys initially for temperature and power
        getKeys(device);

        if (!switchId) return;

        // Update to use init values
        switchValue =
          (message.values?.feature?.[switchId] ? true : false) ?? switchValue;

        // get device info, check if online and if no token is set secure device with token
        getInfo(device);
        ip_addr = device.conf.ip;

        // Fetch data initially
        fetchData();

        // Poll every 30 seconds
        setInterval(fetchData, requestInterval || 30000);
        break;
      case "redis":
        const redisData = message.message;
        if (
          redisData.hasOwnProperty("feature") &&
          redisData.feature.hasOwnProperty(switchId)
        ) {
          if (!switchId) return;
          const newSwitchValue = redisData.feature[switchId];
          if (switchValue !== newSwitchValue && !deviceDisabled && ip_addr) {
            // send new value to device
            switchValue = newSwitchValue;
            sendRelay(ip_addr, switchValue);
          }
        }
        break;
      default:
        break;
    }
  });
}
