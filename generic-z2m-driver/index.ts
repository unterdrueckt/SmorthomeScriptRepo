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
let featureValue: Map<string, any> = new Map();

// Check if the feature already exists in the array
function featureExists(featuresArray: Feature[], featureName: string): boolean {
  return featuresArray.some((feature) => feature.types.includes(featureName));
}

// zigbee2mqtt/bridge/devices

function initDeviceFromMessage(message) {
  if (message) {
    parentPort?.postMessage({
      type: "editDevice",
      update: {
        manufacturer: message.vendor,
        // manufacturer: message.manufacturer,
        deviceType: message.model,
        deviceModel: message.model_id,
        firmwareVersion: message.software_build_id,
      },
      preventRestart: true,
    });

    switch (message.model) {
      case "E2201":
        // IKEA: RODRET wireless dimmer/power switch - https://www.zigbee2mqtt.io/devices/E2201.html
        // Exposes:	identify, battery, action, linkquality
        let anyFeatureMissing1 = !(
          featureExists(device.features, "state") &&
          featureExists(device.features, "action_string") &&
          featureExists(device.features, "last_action_time")
        );
        parentPort?.postMessage({
          type: "editDevice",
          update: {
            icon: anyFeatureMissing1 ? "mdi-light-switch-off" : device.icon,
            conf: {
              topics: [`zigbee2mqtt/${device?.conf?.friendly_name}/#`],
              friendly_name: device?.conf?.friendly_name,
              type: message.model,
              inited: true,
            },
            ...(anyFeatureMissing1 && {
              features: [
                {
                  name: "Switch state",
                  category: "sensor",
                  verifyvalue: "^(?:true|false)$",
                  unit: "",
                  icon: "sym_o_switch",
                  types: ["state", "switch", "boolean"],
                },
                {
                  name: "Action",
                  category: "sensor",
                  verifyvalue:
                    "^(on|off|brightness_move_up|brightness_move_down|brightness_stop)$",
                  unit: "",
                  icon: "mdi-gesture-tap-button",
                  types: ["string", "action", "action_string"],
                },
                {
                  name: "Last action time",
                  category: "sensor",
                  verifyvalue: "^d{4}-d{2}-d{2} d{2}:d{2}:d{2}$",
                  unit: "",
                  icon: "mdi-clock-time-four-outline",
                  types: ["last_action_time", "time", "unix", "timestamp"],
                },
              ],
            }),
          },
        });
        break;
      case "E2204":
        // IKEA: TRETAKT smart plug - https://www.zigbee2mqtt.io/devices/E2204.html
        // Exposes:	switch (state), power_on_behavior, identify, linkquality
        let anyFeatureMissing2 = !featureExists(device.features, "switch");
        parentPort?.postMessage({
          type: "editDevice",
          update: {
            icon: anyFeatureMissing2 ? "eva-power-outline" : device.icon,
            conf: {
              topics: [`zigbee2mqtt/${device?.conf?.friendly_name}/#`],
              friendly_name: device?.conf?.friendly_name,
              type: message.model,
              inited: true,
            },
            ...(anyFeatureMissing2 && {
              features: [
                {
                  name: "Switch",
                  category: "action",
                  verifyvalue: "^(?:true|false)$",
                  unit: "",
                  icon: "eva-power-outline",
                  types: ["switch", "boolean"],
                },
              ],
            }),
          },
        });
        break;
      case "LED1835C6":
        // IKEA: TRADFRI bulb E12/E14/E17, white spectrum, candle, opal, 450/470/440 lm - https://www.zigbee2mqtt.io/devices/LED1835C6.html
        // Exposes:	light (state, brightness, color_temp, color_temp_startup), effect, power_on_behavior, color_options, identify, linkquality
        let anyFeatureMissing3 =
          !featureExists(device.features, "switch") ||
          !featureExists(device.features, "brightness");
        parentPort?.postMessage({
          type: "editDevice",
          update: {
            icon: anyFeatureMissing3 ? "mdi-lightbulb-outline" : device.icon,
            conf: {
              topics: [`zigbee2mqtt/${device?.conf?.friendly_name}/#`],
              friendly_name: device?.conf?.friendly_name,
              type: message.model,
              transition: 1,
              state_skip_transition: true,
              inited: true,
            },
            ...(anyFeatureMissing3 && {
              features: [
                {
                  name: "State",
                  category: "action",
                  verifyvalue: "^(?:true|false)$",
                  unit: "",
                  icon: "mdi-lightbulb-on-outline",
                  types: ["state", "switch", "boolean"],
                },
                {
                  name: "Brightness",
                  category: "action",
                  verifyvalue: "^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
                  unit: "",
                  icon: "mdi-lightbulb-on-50",
                  types: ["brightness", "8bit", "percent"],
                },
                {
                  name: "Color temperature",
                  category: "action",
                  verifyvalue: "^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$",
                  unit: "",
                  icon: "mdi-invert-colors",
                  types: ["color_temp", "8bit", "percent"],
                },
              ],
            }),
          },
        });
        break;

      default:
        break;
    }

    parentPort?.postMessage({
      type: "setData",
      options: {
        status: message?.availability_state || "unkown",
        feature: {},
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
  try {
    const messageJson = JSON.parse(message.message);

    if (!device?.conf?.inited) {
      if (
        message.topic ==
        `zigbee2mqtt/${device?.conf?.friendly_name}/deviceinfos`
      ) {
        initDeviceFromMessage(messageJson);
      }
      return;
    }

    if (message.topic == `zigbee2mqtt/${device?.conf?.friendly_name}`) {
      const str_feature_id = getFeatureByTypeOrNameOrId(device, "action_string")
        ?._id as string;
      const time_feature_id = getFeatureByTypeOrNameOrId(
        device,
        "last_action_time"
      )?._id as string;
      const state_feature_id = getFeatureByTypeOrNameOrId(device, "state")
        ?._id as string;
      if (messageJson?.action) {
        const timeStamp = Date.now();
        featureValue.set(str_feature_id, messageJson?.action);
        featureValue.set(time_feature_id, timeStamp);
        if (messageJson?.action == "on") {
          featureValue.set(state_feature_id, "on");
        } else if (messageJson?.action == "off") {
          featureValue.set(state_feature_id, "off");
        }
        parentPort?.postMessage({
          type: "setData",
          options: {
            feature: {
              [str_feature_id]: messageJson?.action,
              [time_feature_id]: timeStamp,
              [state_feature_id]: featureValue.get(state_feature_id),
            },
          },
        });
      }
    } else if (
      message.topic == `zigbee2mqtt/${device?.conf?.friendly_name}/availability`
    ) {
      parentPort?.postMessage({
        type: "setData",
        options: {
          status: String(messageJson?.state),
          feature: {},
        },
      });
    }
  } catch (errorCatch) {
    console.log(`ERR: ${errorCatch}`);
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
      const oldValue = featureValue.get(id);
      // ? Return if no new value is received may be change in the future.
      if (oldValue != undefined && oldValue === value) return;
      featureValue.set(id, value);
      const feature = getFeatureByTypeOrNameOrId(device, id);
      if (feature?.category != "action" || !device.conf?.type) continue;
      switch (device.conf?.type) {
        case "E2204":
          if (feature?.types?.includes("switch")) {
            parentPort?.postMessage({
              type: "publishMessage",
              topic: `zigbee2mqtt/${device?.conf?.friendly_name}/set`,
              message: JSON.stringify({
                state: value ? "ON" : "OFF",
              }),
            });
          }
          break;
        case "LED1835C6":
          if (feature?.types?.includes("state")) {
            parentPort?.postMessage({
              type: "publishMessage",
              topic: `zigbee2mqtt/${device?.conf?.friendly_name}/set`,
              message: JSON.stringify({
                state: value ? "ON" : "OFF",
                transition: device.conf?.state_skip_transition
                  ? 0
                  : device.conf?.transition || 0,
              }),
            });
          } else if (feature?.types?.includes("brightness")) {
            const state_feature_id = getFeatureByTypeOrNameOrId(
              device,
              "state"
            )?._id;
            parentPort?.postMessage({
              type: "publishMessage",
              topic: `zigbee2mqtt/${device?.conf?.friendly_name}/set`,
              message: JSON.stringify({
                brightness: value,
                transition: device.conf?.transition || 0,
              }),
            });
            if (
              state_feature_id &&
              featureValue.get(state_feature_id) != (value ? true : false)
            ) {
              parentPort?.postMessage({
                type: "setData",
                options: {
                  feature: {
                    [state_feature_id]: value ? true : false,
                  },
                },
              });
            }
          } else if (feature?.types?.includes("color_temp")) {
            const mapped_value = (value / 255) * (454 - 250) + 250;
            parentPort?.postMessage({
              type: "publishMessage",
              topic: `zigbee2mqtt/${device?.conf?.friendly_name}/set`,
              message: JSON.stringify({
                color_temp: mapped_value,
                transition: device.conf?.transition || 0,
              }),
            });
          }
          break;

        default:
          break;
      }
      // if (feature?.types?.includes("pwm")) {
      //   const pin = feature.types
      //     .find((type) => type.startsWith("pin:"))
      //     ?.replace("pin:", "");
      //   if (pin) {
      //     let pwm_value;
      //     let fade_time = 0; // Default fade time is 0 ms
      //     if (
      //       typeof value === "boolean" ||
      //       value === "true" ||
      //       value === "false"
      //     ) {
      //       pwm_value = value === true || value === "true" ? 255 : 0; // Convert boolean or string 'true' or 'false' to 0 or 255
      //     } else {
      //       pwm_value = parseInt(value); // Convert string to integer

      //       pwm_value = 2.5 * pwm_value;
      //       if (isNaN(pwm_value)) {
      //         console.error(
      //           `Invalid value received for feature ${id}: ${value}`
      //         );
      //         continue; // Skip this feature if the value is not a valid number
      //       }
      //       fade_time = getPWMFadeTime(device, pin);
      //     }
      //     parentPort?.postMessage({
      //       type: "publishMessage",
      //       topic: `/device/${device._id}/pwm/${pin}`,
      //       message: JSON.stringify({
      //         value: pwm_value,
      //         fade: fade_time,
      //       }),
      //     });
      //   }
      // }
    }
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
        if (
          !device.conf?.topics?.includes(
            `zigbee2mqtt/${device?.conf?.friendly_name}/#`
          )
        ) {
          parentPort?.postMessage({
            type: "editDevice",
            update: {
              conf: {
                topics: [`zigbee2mqtt/${device?.conf?.friendly_name}/#`],
                friendly_name: device?.conf?.friendly_name,
                type: null,
                inited: false,
              },
            },
          });
          return;
        }
        if (!device.conf?.inited) {
          parentPort?.postMessage({
            type: "setData",
            options: {
              status: "searching",
              feature: {},
            },
          });
          parentPort?.postMessage({
            type: "publishMessage",
            topic: `zigbee2mqtt/${device?.conf?.friendly_name}/request/deviceinfos`,
            message: "1",
          });
          return;
        }

        break;
      case "mqtt":
        handleMqttMessage(message, device);
        break;
      case "redis":
        handleRedisMessage(message, device);
        break;
      default:
        break;
    }
  });
}
