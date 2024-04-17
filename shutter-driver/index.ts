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

// Check if parentPort exists to avoid runtime errors
if (!parentPort) {
  console.error("Error: 'parentPort' is not available.");
  throw Error("Error: 'parentPort' is not available.");
}

// ----------------------------------------------------------
// ----------------- Device connection code -----------------
// ----------------------------------------------------------
//

let device_features: Record<
  string,
  { id: string; value: number; command?: string; initCommand?: string }
> = {
  temperature: { id: "", value: 0.0 },
  shutterY: {
    id: "",
    value: 0,
    command: "setShutterPositionPercentageTarget",
    initCommand: "setShutterPositionPercentage",
  },
  shutterTilt: {
    id: "",
    value: 0,
    command: "setTiltPercentageTarget",
    initCommand: "setShutterPositionPercentage",
  },
};

/**
 * Finds an entry in device_features based on the provided id.
 * @param idToFind - The id to search for in the entries.
 * @returns The entry with the matching id or undefined if not found.
 */
function findEntryById(
  idToFind: string
):
  | { id: string; value: number; command?: string; initCommand?: string }
  | undefined {
  const entries = Object.values(device_features);
  return entries.find((entry) => entry.id === idToFind);
}

/**
 * Finds the key (property name) in device_features based on the provided id.
 * @param idToFind - The id to search for in the keys.
 * @returns The key with the matching id or undefined if not found.
 */
function findKeyById(idToFind: string): string | undefined {
  const keys = Object.keys(device_features);
  return keys.find((key) => device_features[key].id === idToFind);
}

let searching = true;
let deviceStatus = "";
let device: DeviceDocument;
const requestStatusTimeoutTime = 3 * 60 * 1000;
const setOffineTimeoutTime = 5 * 60 * 1000;
let setOffineTimeout: any; // NodeJS.Timeout
let requestStatusTimeout: any; // NodeJS.Timeout

/**
 * Initializes the searching process for a device.
 *
 * This function sends messages to the parent process to set the device configuration for searching mode.
 * It updates the topics in the configuration and sets the status to 'searching'.
 *
 * @param device - The DeviceDocument representing the device.
 */
function initSearching(device: DeviceDocument) {
  parentPort?.postMessage({
    type: "setData",
    options: { status: "searching", feature: {} },
  });
  if (
    !device.conf ||
    !device.conf.topics ||
    !device.conf.topics.includes("/newdevice/#")
  ) {
    parentPort?.postMessage({
      type: "editDevice",
      update: {
        conf: {
          topics: ["/newdevice/#", `/device/${device._id.toString()}/#`],
          searching: true,
        },
      },
    });
  }
}

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

// Check if the feature already exists in the array
function featureExists(featuresArray: Feature[], featureName: string): boolean {
  return featuresArray.some((feature) => feature.types.includes(featureName));
}

/**
 * Handles the initialization message for a device.
 *
 * This function checks if a device configuration exists or if the device is in search mode.
 * If the device configuration is missing or the device is searching, it initiates the searching process.
 * Otherwise, it populates feature IDs for specific device_features when not in search mode.
 *
 * @param device - The DeviceDocument representing the device.
 * @returns A boolean value indicating whether the initialization was handled successfully.
 *          Returns `true` if searching was initiated, and `false` otherwise.
 */
function handleInitMessage(device: DeviceDocument, deviceValues: any): boolean {
  if (
    !device.conf ||
    !Object.keys(device.conf).length ||
    (device.conf && device.conf.searching != false)
  ) {
    initSearching(device);
    return true;
  } else {
    device_features["temperature"].id = findFeatureId(
      device.features,
      "temperature"
    );
    device_features["temperature"].value =
      deviceValues.feature[device_features["temperature"].id];
    device_features["shutterY"].id = findFeatureId(device.features, "shutterY");
    device_features["shutterY"].value =
      deviceValues.feature[device_features["shutterY"].id];
    device_features["shutterTilt"].id = findFeatureId(
      device.features,
      "shutterTilt"
    );
    device_features["shutterTilt"].value =
      deviceValues.feature[device_features["shutterTilt"].id];
    return false;
  }
}

function sendDeviceSettings() {
  // Check and set shutterMovementTime
  let shutterMovementTime = device.conf.shutterMovementTime;
  if (typeof shutterMovementTime === "string") {
    shutterMovementTime = parseFloat(shutterMovementTime);
  }
  if (typeof shutterMovementTime == "number") {
    shutterMovementTime = Math.max(800, Math.min(60000, shutterMovementTime));
    parentPort?.postMessage({
      type: "publishMessage",
      topic: `/device/${device._id.toString()}/setShutterMovementTime`,
      message: shutterMovementTime.toString(),
    });
  }

  // Check and set tiltMovementTime
  let tiltMovementTime = device.conf.tiltMovementTime;
  if (typeof tiltMovementTime === "string") {
    tiltMovementTime = parseFloat(tiltMovementTime);
  }
  if (typeof tiltMovementTime == "number") {
    tiltMovementTime = Math.max(500, Math.min(60000, tiltMovementTime));
    parentPort?.postMessage({
      type: "publishMessage",
      topic: `/device/${device._id.toString()}/setTiltMovementTime`,
      message: tiltMovementTime.toString(),
    });
  }

  // set device values
  if (device_features) {
    for (const key in device_features) {
      const feature = device_features[key];
      if (feature && feature.id && feature.value != undefined) {
        if (feature.initCommand) {
          parentPort?.postMessage({
            type: "publishMessage",
            topic: `/device/${device._id.toString()}/${feature.initCommand}`,
            message: feature.value,
          });
        }
      }
    }
  }

  // request device infos
  parentPort?.postMessage({
    type: "publishMessage",
    topic: `/device/${device._id.toString().toString()}/request`,
    message: "infos",
  });
}

// ----------------------------------------------------------
// -- functions to handle the init connection (searching) ---
// ----------------------------------------------------------

/**
 * Handles MQTT messages during the device searching process.
 *
 * This function routes incoming MQTT messages based on their topic:
 * - If the topic starts with '/newdevice/shutter', it calls 'handleNewDeviceMessage'.
 * - If the topic starts with `/device/${device._id.toString()}/registered`, it calls 'handleRegisteredDeviceMessage'.
 *
 * @param message - The MQTT message received.
 * @param device - The DeviceDocument representing the device.
 */
function handleSearchingMqttMessage(message, device: DeviceDocument) {
  if (message.topic.startsWith("/newdevice/shutter")) {
    handleNewDeviceMessage(message, device);
  } else if (
    message.topic.startsWith(`/device/${device._id.toString()}/registered`)
  ) {
    handleRegisteredDeviceMessage(message, device);
  }
}

/**
 * Handles incoming MQTT messages for new devices.
 *
 * This function processes the MQTT message, expecting it to contain JSON data.
 * If the message contains 'tempID', it sends a publish message with the device ID.
 *
 * @param message - The MQTT message received.
 * @param device - The DeviceDocument representing the device.
 */
function handleNewDeviceMessage(message, device: DeviceDocument) {
  if (message.message) {
    try {
      const jsonmessage = JSON.parse(message.message);
      if (jsonmessage.tempID) {
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/newdevice/${jsonmessage.tempID}`,
          message: device._id.toString(),
        });
      }
    } catch {}
  }
}

/**
 * Handles incoming MQTT messages for new registered devices.
 *
 * This function updates the device configuration and features based on the received message.
 * It typically sets 'searching' to false and updates the features list.
 *
 * @param message - The MQTT message received.
 * @param device - The DeviceDocument representing the device.
 */
function handleRegisteredDeviceMessage(message, device: DeviceDocument) {
  if (message.message) {
    // Restarts the driver after this call
    // Check if temperature, shutterY, and shutterTilt exist
    const tempExists = featureExists(device.features, "temperature");
    const shutterYExists = featureExists(device.features, "shutterY");
    const shutterTiltExists = featureExists(device.features, "shutterTilt");

    const anyFeatureMissing = !(
      tempExists &&
      shutterYExists &&
      shutterTiltExists
    );
    parentPort?.postMessage({
      type: "editDevice",
      update: {
        conf: {
          topics: [`/device/${device._id.toString()}/#`],
          searching: false,
          shutterMovementTime: 10000,
          tiltMovementTime: 2000,
        },
        ...(anyFeatureMissing && {
          features: [
            {
              name: "Temperature",
              category: "sensor",
              verifyvalue:
                "^-?(30(.00?)?|100(.00?)?|([0-9]|[1-9][0-9])(.d{2})?)$",
              unit: "°C",
              icon: "eva-thermometer",
              types: ["temperature"],
            },
            {
              name: "ShutterY",
              category: "action",
              verifyvalue: "^(100|0|[1-9][0-9]?)$",
              type: "switch",
              icon: "sym_o_blinds",
              types: ["percent", "shutter", "movement", "shutterY", "updown"],
            },
            {
              name: "ShutterTilt",
              category: "action",
              verifyvalue: "^(100|0|[1-9][0-9]?)$",
              type: "switch",
              icon: "sym_o_filter_tilt_shift",
              types: ["percent", "shutter", "movement", "shutterTilt", "tilt"],
            },
          ],
        }),
      },
    });
  }
}

// ----------------------------------------------------------
// --- functions to handle the device (fully registered)  ---
// ----------------------------------------------------------

/**
 * Handles MQTT messages related to temperature data and device info for a specific device.
 *
 * This function processes incoming MQTT messages with topics starting with `/device/${device._id.toString()}/temperature` and `/device/${device._id.toString()}/info`.
 * If a valid message is received, it sends a 'setData' message to update the temperature feature's value
 * and sets the device status to 'online'. It also updates the device info if a valid info message is received.
 *
 * @param message - The MQTT message received.
 * @param device - The DeviceDocument representing the device.
 */
function handleMqttMessage(message: any, device: DeviceDocument) {
  if (
    message.topic.startsWith(`/device/${device._id.toString()}/temperature`)
  ) {
    if (message.message && !isNaN(parseFloat(message.message))) {
      const temp = parseFloat(message.message);
      device_features["temperature"].value = temp;
      parentPort?.postMessage({
        type: "setData",
        options: {
          feature: {
            [device_features["temperature"].id]: temp,
          },
        },
      });
    }
  } else if (
    message.topic.startsWith(`/device/${device._id.toString()}/info`)
  ) {
    let infoMessage = message.message;
    if (typeof infoMessage === "string") {
      try {
        infoMessage = JSON.parse(infoMessage);
      } catch (e) {
        console.error("Error parsing JSON string:", e);
        return;
      }
    }
    if (infoMessage && typeof infoMessage === "object") {
      parentPort?.postMessage({
        type: "editDevice",
        update: {
          mac: infoMessage.mac,
          ip: infoMessage.ip,
          firmwareVersion: infoMessage.firmware,
          deviceModel: infoMessage.model || "NO MODEL?",
          chipID: infoMessage.chipID,
        },
        preventRestart: true,
      });
      if (deviceStatus != "online") {
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/device/${device._id.toString()}/request`,
          message: "status",
        });
      }
    }
  } else if (
    message.topic.startsWith(`/device/${device._id.toString()}/status`)
  ) {
    if (deviceStatus != message.message && message.message == "online") {
      sendDeviceSettings();
    }
    deviceStatus = message.message || "error";
    parentPort?.postMessage({
      type: "setData",
      options: {
        status: String(deviceStatus),
        feature: {},
      },
    });
  }
}

/**
 * Handle a message from Redis.
 * @param message The message from Redis.
 * @param device - The DeviceDocument representing the device.
 */
// For handling Redis message
function handleRedisMessage(message: any, device: DeviceDocument) {
  const redisData = message.message;
  if (redisData.hasOwnProperty("feature")) {
    for (const [id, value] of Object.entries(redisData.feature) as any) {
      const feature = findEntryById(id);
      const oldFeatureValue = feature?.value;
      if (feature) {
        if (feature.value !== parseFloat(value) && feature.command) {
          feature.value = parseFloat(value);
          parentPort?.postMessage({
            type: "publishMessage",
            topic: `/device/${device._id.toString()}/${feature.command}`,
            message: feature.value,
          });

          // When shutterY is 0 (completely open) set tilt to 100 (completely open)
          if (
            findKeyById(id) == "shutterY" &&
            feature.value != oldFeatureValue &&
            feature.value == 0 &&
            device_features["shutterTilt"].value != 100
          ) {
            parentPort?.postMessage({
              type: "setData",
              options: {
                feature: {
                  [device_features["shutterTilt"].id]: 100,
                },
              },
            });
          }
        }
      }
    }
  }
}

// Helper function to request status if no update is received for a specified duration
function offlineTimeoutStart(clear = true) {
  if (clear) {
    clearTimeout(setOffineTimeout);
    setOffineTimeout = undefined;
    clearTimeout(requestStatusTimeout);
    requestStatusTimeout = undefined;
  }

  if (!requestStatusTimeout) {
    requestStatusTimeout = setTimeout(() => {
      parentPort?.postMessage({
        type: "publishMessage",
        topic: `/device/${device._id.toString()}/request`,
        message: "status",
      });
      offlineTimeoutStart(false);
    }, requestStatusTimeoutTime);
  }

  if (!setOffineTimeout) {
    setOffineTimeout = setTimeout(() => {
      parentPort?.postMessage({
        type: "setData",
        options: {
          status: "offline",
          feature: {},
        },
      });
      offlineTimeoutStart(false);
    }, setOffineTimeoutTime);
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
        device = message.device;
        searching = handleInitMessage(device, message.values);
        offlineTimeoutStart();
        break;
      case "mqtt":
        if (searching) {
          handleSearchingMqttMessage(message, device);
        } else {
          handleMqttMessage(message, device);
        }
        break;
      case "redis":
        handleRedisMessage(message, device);
        break;
      default:
        break;
    }
    if (message.type === "init") {
    }
  });
}
