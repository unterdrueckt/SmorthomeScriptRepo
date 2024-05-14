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
//

let searching = true;
let deviceStatus = "";
let device: DeviceDocument;
const requestStatusTimeoutTime = 3 * 60 * 1000;
const setOffineTimeoutTime = 5 * 60 * 1000;
let setOffineTimeout: any; // NodeJS.Timeout
let requestStatusTimeout: any; // NodeJS.Timeout
let addFeatureProcess: Array<string> = [];
let featureValue: Map<string, any> = new Map();

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
          topics: ["/newdevice/#", `/device/${device._id}/#`],
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
    for (const featureKey in deviceValues?.feature) {
      featureValue.set(featureKey, deviceValues?.feature?.[featureKey]);
    }
    for (const feature of device.features) {
      if (!featureValue.has(feature._id)) {
        featureValue.set(feature._id, undefined);
      }
    }
    return false;
  }
}

function sendDeviceSettings() {
  if (device.conf.ledConfig !== undefined) {
    try {
      parentPort?.postMessage({
        type: "publishMessage",
        topic: `/device/${device._id}/config/led`,
        message: JSON.stringify(device.conf.ledConfig),
      });
    } catch {}
  }
  if (device.conf.neopixelConfig !== undefined) {
    try {
      parentPort?.postMessage({
        type: "publishMessage",
        topic: `/device/${device._id}/config/neopixel`,
        message: JSON.stringify(device.conf.neopixelConfig),
      });
    } catch {}
  }
  for (const [key, value] of featureValue) {
    const feature = getFeatureByTypeOrNameOrId(device, key);
    if (!feature) continue;
    const pin = feature.types
      .find((type) => type.startsWith("pin:"))
      ?.replace("pin:", "");
    if (pin) {
      if (feature.types.includes("state")) {
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/device/${device._id}/config/pin`,
          message: JSON.stringify({ [pin]: "switch" }),
        });
      }
      if (feature.types.includes("pwm")) {
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/device/${device._id}/config/pin`,
          message: JSON.stringify({ [pin]: "channel" }),
        });
      }
    }
    if (feature?.category != "action") continue;
    if (
      feature?.types?.includes("color") &&
      feature?.types?.some(
        (type) => type.startsWith("neopixel:") || type == "neopixel"
      )
    ) {
      const pixel = feature.types
        .find((type) => type.startsWith("neopixel:"))
        ?.replace("neopixel:", "");
      if (pixel) {
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/device/${device._id}/pixel/${pixel}`,
          message: JSON.stringify({ ...hexToRgb(value) }),
        });
      } else {
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/device/${device._id}/rgb`,
          message: JSON.stringify({ ...hexToRgb(value), ...{ fade: 1000 } }),
        });
      }
    }
    if (feature?.types && pin) {
      let pwm_value;
      let fade_time = 0; // Default fade time is 0 ms
      if (typeof value === "boolean" || value === "true" || value === "false") {
        pwm_value = value === true || value === "true" ? 255 : 0; // Convert boolean or string 'true' or 'false' to 0 or 255
      } else {
        pwm_value = parseInt(value); // Convert string to integer

        pwm_value = 2.5 * pwm_value;
        if (isNaN(pwm_value)) {
          console.error(`Invalid value received for feature ${key}: ${value}`);
          continue; // Skip this feature if the value is not a valid number
        }
        fade_time = getPWMFadeTime(device, pin);
      }
      parentPort?.postMessage({
        type: "publishMessage",
        topic: `/device/${device._id}/pwm/${pin}`,
        message: JSON.stringify({
          value: pwm_value,
          fade: fade_time,
        }),
      });
    }
    if (feature?.types.includes("neopixel_brightness")) {
      parentPort?.postMessage({
        type: "publishMessage",
        topic: `/device/${device._id}/config/neopixel`,
        message: JSON.stringify({
          brightness: value,
        }),
      });
    }
  }

  // request device infos
  parentPort?.postMessage({
    type: "publishMessage",
    topic: `/device/${device._id}/request`,
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
 * - If the topic starts with '/newdevice/esp_pwm', it calls 'handleNewDeviceMessage'.
 * - If the topic starts with `/device/${device._id}/registered`, it calls 'handleRegisteredDeviceMessage'.
 *
 * @param message - The MQTT message received.
 * @param device - The DeviceDocument representing the device.
 */
function handleSearchingMqttMessage(message, device: DeviceDocument) {
  if (message.topic.startsWith("/newdevice/esp_pwm")) {
    handleNewDeviceMessage(message, device);
  } else if (message.topic.startsWith(`/device/${device._id}/registered`)) {
    handleRegisteredDeviceMessage(message, device);
  }
  offlineTimeoutStart();
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
    const tempExists = featureExists(device.features, "temperature");
    const pwmExists = featureExists(device.features, "pwm");

    const anyFeatureMissing = !pwmExists;
    parentPort?.postMessage({
      type: "editDevice",
      update: {
        conf: {
          topics: [`/device/${device._id}/#`],
          searching: false,
          fadetime: 500,
        },
        ...(anyFeatureMissing && {
          features: [
            {
              name: "Channel 1",
              category: "action",
              verifyvalue: "^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
              unit: "",
              icon: "mdi-pulse",
              types: ["channel1", "8bit", "pwm"],
            },
            {
              name: "Channel 2",
              category: "action",
              verifyvalue: "^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
              unit: "",
              icon: "mdi-pulse",
              types: ["channel2", "8bit", "pwm"],
            },
            {
              name: "Channel 3",
              category: "action",
              verifyvalue: "^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
              unit: "",
              icon: "mdi-pulse",
              types: ["channel3", "8bit", "pwm"],
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

function getFeatureByTypeOrNameOrId(
  device: DeviceDocument,
  searchString: string
): Feature | undefined {
  // Search for the feature based on type
  let feature = device.features.find(
    (feature) =>
      feature.types.includes(searchString) || feature._id == searchString
  );

  // If feature is not found based on type, search by name
  if (!feature) {
    feature = device.features.find((feature) => feature.name === searchString);
  }

  return feature;
}

/**
 * Handles MQTT messages related to temperature data and device info for a specific device.
 *
 * This function processes incoming MQTT messages with topics starting with `/device/${device._id}/temperature` and `/device/${device._id}/info`.
 * If a valid message is received, it sends a 'setData' message to update the temperature feature's value
 * and sets the device status to 'online'. It also updates the device info if a valid info message is received.
 *
 * @param message - The MQTT message received.
 * @param device - The DeviceDocument representing the device.
 */
function handleMqttMessage(message: any, device: DeviceDocument) {
  if (message.topic.startsWith(`/device/${device._id}/temperature`)) {
    if (message.message && !isNaN(parseFloat(message.message))) {
      const temp = parseFloat(message.message);
      const feature_id = getFeatureByTypeOrNameOrId(device, "temperature")?._id;
      if (!feature_id && !addFeatureProcess.includes("temperature")) {
        addFeatureProcess.push("temperature");
        (device.features as any).push({
          name: "Temperature",
          category: "sensor",
          verifyvalue: "^-?(30(.00?)?|100(.00?)?|([0-9]|[1-9][0-9])(.d{2})?)$",
          unit: "°C",
          icon: "eva-thermometer",
          types: ["temperature"],
        });
        parentPort?.postMessage({
          type: "editDevice",
          update: { features: device.features },
          preventRestart: true,
        });
        setTimeout(function () {
          parentPort?.postMessage({
            type: "publishMessage",
            topic: `/device/${device._id}/request`,
            message: "restart",
          });
          parentPort?.postMessage({
            type: "restartDeviceDriver",
          });
        }, 1500);
      }
      if (feature_id) {
        const oldTempValue = featureValue.get(feature_id);
        const tempDelta =
          oldTempValue !== undefined ? Math.abs(oldTempValue - temp) : Infinity;
        featureValue.set(feature_id, temp);
        parentPort?.postMessage({
          type: "setData",
          storeInDB: tempDelta > 0.1,
          options: {
            feature: {
              [feature_id]: temp,
            },
          },
        });
      }
    }
  } else if (message.topic.startsWith(`/device/${device._id}/humidity`)) {
    if (message.message && !isNaN(parseFloat(message.message))) {
      const hum = parseFloat(message.message);
      const feature_id = getFeatureByTypeOrNameOrId(device, "humidity")?._id;
      if (!feature_id && !addFeatureProcess.includes("humidity")) {
        addFeatureProcess.push("humidity");
        (device.features as any).push({
          name: "Humidity",
          category: "sensor",
          verifyvalue: "^(100(.0{1,2})?|[0-9]{1,2}(.[0-9]{1,2})?)$",
          unit: "%",
          icon: "sym_o_humidity_percentage",
          types: ["humidity"],
        });
        parentPort?.postMessage({
          type: "editDevice",
          update: { features: device.features },
          preventRestart: true,
        });
        setTimeout(function () {
          parentPort?.postMessage({
            type: "publishMessage",
            topic: `/device/${device._id}/request`,
            message: "restart",
          });
          parentPort?.postMessage({
            type: "restartDeviceDriver",
          });
        }, 1500);
      }
      if (feature_id) {
        const oldHumValue = featureValue.get(feature_id);
        const humDelta =
          oldHumValue !== undefined ? Math.abs(oldHumValue - hum) : Infinity;
        featureValue.set(feature_id, hum);
        parentPort?.postMessage({
          type: "setData",
          storeInDB: humDelta > 0.25,
          options: {
            feature: {
              [feature_id]: hum,
            },
          },
        });
      }
    }
  } else if (message.topic.startsWith(`/device/${device._id}/switch`)) {
    // Regular expression to match the number
    const regex = /\/device\/\S+\/switch\/(\d+)/;
    // Use match() to find the number
    const match = message.topic.match(regex);
    if (!match) return;
    const pin = parseInt(match[1], 10);
    const messageValue =
      message.message == "true" || message.message === true ? true : false;
    const feature_id = getFeatureByTypeOrNameOrId(device, `pin:${pin}`)?._id;
    if (!feature_id) return;
    featureValue.set(feature_id, messageValue);
    parentPort?.postMessage({
      type: "setData",
      options: {
        feature: {
          [feature_id]: messageValue,
        },
      },
    });
  } else if (message.topic.startsWith(`/device/${device._id}/info`)) {
    let infoMessage = message.message;
    if (typeof infoMessage === "string") {
      try {
        infoMessage = JSON.parse(infoMessage);
      } catch (e) {
        console.error("Error parsing JSON string:", e);
        return;
      }
    }
    offlineTimeoutStart();
    if (infoMessage && typeof infoMessage === "object") {
      parentPort?.postMessage({
        type: "editDevice",
        update: {
          mac: infoMessage.mac,
          ip: infoMessage.ip,
          firmwareVersion: infoMessage.firmware,
          deviceModel: infoMessage.model || "NO MODEL",
          chipID: infoMessage.chipID,
        },
        preventRestart: true,
      });
      if (deviceStatus != "online") {
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/device/${device._id}/request`,
          message: "status",
        });
      }
    }
  } else if (message.topic.startsWith(`/device/${device._id}/status`)) {
    offlineTimeoutStart();
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
      const feature = getFeatureByTypeOrNameOrId(device, id);
      if (feature?.category != "action") continue;
      if (feature?.types?.includes("pwm")) {
        const pin = feature.types
          .find((type) => type.startsWith("pin:"))
          ?.replace("pin:", "");
        if (pin) {
          let pwm_value;
          let fade_time = 0; // Default fade time is 0 ms
          if (
            typeof value === "boolean" ||
            value === "true" ||
            value === "false"
          ) {
            pwm_value = value === true || value === "true" ? 255 : 0; // Convert boolean or string 'true' or 'false' to 0 or 255
          } else {
            pwm_value = parseInt(value); // Convert string to integer

            pwm_value = 2.5 * pwm_value;
            if (isNaN(pwm_value)) {
              console.error(
                `Invalid value received for feature ${id}: ${value}`
              );
              continue; // Skip this feature if the value is not a valid number
            }
            fade_time = getPWMFadeTime(device, pin);
          }
          parentPort?.postMessage({
            type: "publishMessage",
            topic: `/device/${device._id}/pwm/${pin}`,
            message: JSON.stringify({
              value: pwm_value,
              fade: fade_time,
            }),
          });
        }
      } else if (
        feature?.types?.includes("color") &&
        feature?.types?.some(
          (type) => type.startsWith("neopixel:") || type == "neopixel"
        )
      ) {
        const pixel = feature.types
          .find((type) => type.startsWith("neopixel:"))
          ?.replace("neopixel:", "");
        if (pixel) {
          parentPort?.postMessage({
            type: "publishMessage",
            topic: `/device/${device._id}/pixel/${pixel}`,
            message: JSON.stringify({ ...hexToRgb(value) }),
          });
        } else {
          parentPort?.postMessage({
            type: "publishMessage",
            topic: `/device/${device._id}/rgb`,
            message: JSON.stringify({ ...hexToRgb(value), ...{ fade: 1000 } }),
          });
        }
      } else if (feature?.types.includes("neopixel_brightness")) {
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/device/${device._id}/config/neopixel`,
          message: JSON.stringify({
            brightness: value,
          }),
        });
      }
    }
  }
}

function hexToRgb(hex) {
  // Remove any leading "#"
  hex = hex.replace(/^#?/, "");

  // Expand shorthand notation if necessary
  if (hex.length === 3) {
    hex = hex.replace(/(.)/g, "$1$1");
  }

  // Ensure a valid 6-character hex string
  if (hex.length !== 6) {
    throw new Error("Invalid hex color string");
  }

  // Convert pairs of hex digits to decimal values
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // Create and return the RGB object
  return { r, g, b };
}

function getPWMFadeTime(device: DeviceDocument, channelNumber: string): number {
  // Default fade time
  let defaultFadeTime = device?.conf?.fadetime ?? 500;

  // Construct the property name pattern for the specific channel fade time
  const propertyName = `fade_channel_${channelNumber}`;

  // Check if the specific channel fade time is set
  if (propertyName in device.conf) {
    return device.conf[propertyName];
  }

  // Return the default fade time if the specific pwm channel fade time is not set
  return defaultFadeTime;
}

function findTypesForFeature(
  device: DeviceDocument,
  featureId: string
): string[] | undefined {
  // Find the feature with the specified _id
  const feature = device.features.find((feature) => feature._id === featureId);

  // If feature is found, return its types, otherwise return undefined
  return feature ? feature.types : undefined;
}

function extractNumberFromArray(array) {
  // Regular expression to match strings like "channel<number>"
  const regex = /channel(\d+)/;

  // Variable to store the extracted numbers
  const numbers = [] as Array<number>;

  // Loop through the array of strings
  array.forEach((str) => {
    // Try to match the string with the regular expression
    const match = str.match(regex);

    // If a match is found, extract the number and push it to the numbers array
    if (match) {
      // Extracted number will be in the second capturing group (index 1)
      const number = parseInt(match[1]);
      numbers.push(number);
    }
  });

  // Return the array of extracted numbers
  return numbers;
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
        topic: `/device/${device._id}/request`,
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
      offlineTimeoutStart();
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
        parentPort?.postMessage({
          type: "publishMessage",
          topic: `/device/${device._id}/request`,
          message: "status",
        });
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
  });
}
