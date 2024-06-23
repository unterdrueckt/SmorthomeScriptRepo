// addonconfig = { "url": "", "username": "", "password": "" }
import crypto from "crypto";
// Try to import from 'xml2js'
import * as xml2js from "xml2js";

import { parentPort, isMainThread, workerData } from "worker_threads";

interface Feature {
  _id: string;
  name: string;
  value: any;
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
  status?: string;
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

interface RedisMessageData {
  /**
   * The ID of the device.
   */
  device: string; // deviceId

  /**
   * The data associated with the device.
   */
  data: {
    /**
     * The status of the device.
     */
    status: string; // device status

    /**
     * The features of the device.
     * This is an object where each key is a featureId and each value is the feature value.
     */
    feature: Record<string, any>; // { [featureId]: any[feature value] }
  };
}

// Check if parentPort exists to avoid runtime errors
if (!parentPort) {
  console.error("Error: 'parentPort' is not available.");
  throw Error("Error: 'parentPort' is not available.");
}

// Check if workerData exists and has the required 'devices' property
if (!workerData || !Array.isArray(workerData.devices)) {
  console.error("Error: 'workerData' is missing or does not have the 'devices' property.");
  throw Error("Error: 'workerData' is missing or does not have the 'devices' property.");
}

let sid: string;
const fritzbox_addon_url = workerData.config.url;
if (!fritzbox_addon_url) {
  console.error("url is missing in config");
  throw Error("url is missing in config");
}
const fritzbox_addon_user = workerData.config.username;
if (!fritzbox_addon_url) {
  console.error("username is missing in config");
  throw Error("username is missing in config");
}
const fritzbox_addon_password = workerData.config.password;
if (!fritzbox_addon_password) {
  console.error("password is missing in config");
  throw Error("password is missing in config");
}

// Convert the array to a Map
let devicesMap: Map<string, DeviceDocument>;

let lastLoginTry: number;
let loginTryCount: number;
let lastLoginSuccsess: number;

devicesMap = new Map(
  workerData?.devices.map((device: DeviceDocument) => {
    return [device._id, device];
  })
);

// Create identifierToDeviceIdMap
const identifierToDeviceIdMap = new Map<string, string>();

devicesMap.forEach((device, key) => {
  const { _id, conf } = device;
  const { identifier } = conf;

  if (identifier) {
    identifierToDeviceIdMap.set(identifier, _id);
  }
});

parentPort.on("message", async (message) => {
  try {
    if (!message || !message.type) {
      return;
    }
    if (message.type == "redisMessage") {
      const messageData: RedisMessageData = message.data;
      let device = devicesMap.get(messageData.device);
      if (!device) {
        return;
      }

      // Save the old status and features for comparison
      let oldStatus = device.status;
      let oldFeatureValues = device.features.reduce((obj, feature) => {
        obj[feature._id] = feature?.value ?? null;
        return obj;
      }, {});

      // Update the status and features
      device.status = messageData.data.status;
      device.features = device.features.map((feature) => {
        if (messageData.data.feature && messageData.data.feature[feature._id] !== undefined) {
          feature.value = messageData.data.feature[feature._id];
        }
        return feature;
      });

      // Save the updated device back to devicesMap
      devicesMap.set(messageData.device, device);

      // Call functions for every status or feature that has changed
      if (device.status !== oldStatus) {
        try {
        } catch {}
      }
      device.features.forEach((feature, index) => {
        if (feature.value !== oldFeatureValues[feature._id]) {
          try {
            handleRealtimeDeviceValue(device._id, feature._id, {
              oldvalue: oldFeatureValues[feature._id],
              newvalue: feature.value,
            });
          } catch {}
        }
      });
    }
  } catch (error) {
    console.log(`An error occurred: ${error}`);
  }
});

/**
 * Sends a message to the main thread and waits for a response.
 *
 * @param {string} action - The action to be performed in the main thread.
 * @param {any} data - The data to be sent to the main thread.
 * @returns {Promise<any>} A promise that resolves with the result from the main thread.
 *
 * @example
 * parentAction('myAction', { foo: 'bar' })
 *   .then(result => console.log('Received result from main thread:', result))
 *   .catch(error => console.error('Error from main thread:', error));
 */
async function parentAction(action: string, data: any) {
  return new Promise((resolve, reject) => {
    // Send a message to the main thread
    parentPort.postMessage({ action, data });

    // Function to handle message events
    const messageListener = (msg) => {
      if (msg.action === action) {
        parentPort.off("message", messageListener);
        parentPort.off("error", errorListener);
        resolve(msg.result);
      }
    };

    // Function to handle error events
    const errorListener = (error) => {
      parentPort.off("message", messageListener);
      parentPort.off("error", errorListener);
      reject(error);
    };

    // Listen for a message from the main thread
    parentPort.on("message", messageListener);

    // Listen for an error from the main thread
    parentPort.on("error", errorListener);
  });
}

/**
 * Validates whether a given string is a valid MongoDB ObjectId.
 * An ObjectId is a 24-character hexadecimal string.
 *
 * @param {string} id - The string to be validated as a MongoDB ObjectId.
 * @returns {boolean} - Returns true if the provided string is a valid ObjectId, otherwise false.
 */
function isValidObjectId(id: string): boolean {
  const checkForHexRegExp = new RegExp("^[0-9a-fA-F]{24}$");
  return checkForHexRegExp.test(id);
}

/**
 * Retrieves a device from devicesMap using its _id, name, or feature _id.
 * @param {string} deviceSearch - The _id, name, or feature _id of the device to retrieve.
 * @returns {DeviceDocument | undefined} - The DeviceDocument of the device, or undefined if the device is not found.
 */
function getDevice(deviceSearch: string): DeviceDocument | undefined {
  if (isValidObjectId(deviceSearch)) {
    return devicesMap.get(deviceSearch);
  }
  // Convert the values of devicesMap (which are the device objects) into an array
  const devices = Array.from(devicesMap.values());

  return devices.find(
    (device) =>
      deviceSearch === device._id ||
      deviceSearch === device.name ||
      device.features.some((feature) => deviceSearch === feature._id)
  );
}

/**
 * Retrieves a feature from a device using its _id, name, or type.
 * @param {string} deviceSearch - The _id of the device that the feature belongs to.
 * @param {string} featureSearch - The _id, name, or type of the feature to retrieve.
 * @returns {Feature | undefined} - The Feature of the device, or undefined if the device or the feature is not found.
 */
function getFeature(deviceSearch: string, featureSearch: string): Feature | undefined {
  let device = getDevice(deviceSearch);
  if (device) {
    return device.features.find((feature) => {
      return feature._id === featureSearch || feature.name == featureSearch || feature.types.includes(featureSearch);
    });
  }
  return undefined;
}

/**
 * Sets a parameter for a device on the FritzBox using the AHA HTTP Interface.
 *
 * @param command - The command to execute. Important commands include:
 *   - 'sethkrtsoll': Sets the target temperature for a radiator controller. The 'param' should be the desired temperature multiplied by 2.
 *   - 'setswitchon': Sets the switch state of a smart plug to on.
 *   - 'setswitchoff': Sets the switch state of a smart plug to off.
 * @param ain - The AIN (Actor Identification Number) of the device. This is a unique identifier assigned to each device.
 * @param param - The parameter to set. The meaning of this depends on the command.
 *
 * @returns A Promise that resolves when the operation is complete. If the HTTP request fails with a status code in the 400-499 range, the function will attempt to fetch a new SID.
 */
async function setFritzBoxParameter(command: string, ain: string, param?: number | string): Promise<void> {
  const url = `${fritzbox_addon_url}/webservices/homeautoswitch.lua?switchcmd=${command}&sid=${sid}&ain=${encodeURIComponent(
    ain
  )}${param ? `&param=${param}` : ""}`;
  console.log(`Setting device ${ain} to ${command} ${param}`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`HTTP ${command} error! status: ${response.status}`);
    if (response.status >= 400 && response.status < 500) {
      console.error("Fetching new FritzBox SID...");
      getFritzBoxSID();
    }
    return;
  }
}

async function getFritzBoxSID(): Promise<true | false> {
  const maxLoginInterval = 30 * 1000; // 30 seconds
  const currentTime = Date.now();

  // Check if the last login try was less than 30 seconds ago
  if (lastLoginTry && currentTime - lastLoginTry < maxLoginInterval) {
    console.log("Login attempt skipped. Last login was recent.");
    return false;
  }

  if (loginTryCount >= 20) {
    console.error(`Exceeded maximum retrys for login attempts.`);
    process.exit();
    throw new Error(`Exceeded maximum retrys for login attempts.`);
  }

  // Update last login time
  lastLoginTry = currentTime;
  loginTryCount++;

  const url = `${fritzbox_addon_url}/login_sid.lua`;

  const response = await fetch(url);
  const data = await response.text();

  if (!data) {
    console.log("No data received");
    return false;
  }

  let tempSid = data.match(/<SID>(.*?)<\/SID>/)?.[1] || "";

  if (tempSid === "0000000000000000") {
    const challenge = data.match(/<Challenge>(.*?)<\/Challenge>/)?.[1];

    if (!challenge) {
      console.log("No challenge received");
      return false;
    }

    const responseToChallenge =
      challenge +
      "-" +
      crypto
        .createHash("md5")
        .update(Buffer.from(challenge + "-" + fritzbox_addon_password, "utf16le"))
        .digest("hex");

    const urlWithCredentials = `${url}?username=${encodeURIComponent(
      fritzbox_addon_user
    )}&response=${encodeURIComponent(responseToChallenge)}`;

    const responseWithCredentials = await fetch(urlWithCredentials);

    const dataWithCredentials = await responseWithCredentials.text();
    sid = dataWithCredentials.match(/<SID>(.*?)<\/SID>/)?.[1] || tempSid;

    if (sid == "0000000000000000") {
      console.error(`Invalid sid`);
      return false;
    }
    console.log(`Login status: ${responseWithCredentials.status}`);
    lastLoginSuccsess = currentTime;
    return true;
  }

  return false;
}

async function getSmartHomeDevices(): Promise<any> {
  const url = `${fritzbox_addon_url}/webservices/homeautoswitch.lua?switchcmd=getdevicelistinfos&sid=${sid}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      getFritzBoxSID();
      console.log(`HTTP getSmartHomeDevices error! status: ${response.status}`);
      return;
    }

    const devicesXML = await response.text();
    const devices = await parseXml(devicesXML);

    if (devices && devices.devicelist && devices.devicelist.device) {
      await processFritzDevices(devices);
    }

    return devices;
  } catch (error) {
    console.error(error);
  }
}

async function processFritzDevices(devices: any): Promise<void> {
  for (const [index, fritzdevice] of devices.devicelist.device.entries()) {
    if (!identifierToDeviceIdMap.has(fritzdevice.identifier)) {
      await processUnkownDevice(fritzdevice);
    }
    if (identifierToDeviceIdMap.has(fritzdevice.identifier)) {
      await processKownDevice(fritzdevice);
    }
  }
}

async function processKownDevice(fritzdevice: any): Promise<void> {
  const deviceId = identifierToDeviceIdMap.get(fritzdevice.identifier);

  if (!deviceId) {
    return;
  }

  let device = devicesMap.get(deviceId);

  if (!device || !device.conf || !device.conf.identifier) {
    return;
  }

  const setDataOption = {
    status: fritzdevice.present == "1" ? "online" : "offline",
    feature: {},
  };

  for (const [findex, feature] of device.features.entries()) {
    const tempValue = getFeatureValue(fritzdevice, feature);
    setDataOption.feature[feature._id] = tempValue;

    // Find the feature in the device.features array and update its value
    let feat = device.features.find((ffeature) => ffeature._id == feature._id);
    if (feat) {
      feat.value = tempValue;
    }
  }
  devicesMap.set(device._id, device);

  await updateDeviceData(deviceId, setDataOption);
}

function getFeatureValue(fritzdevice: any, feature: any): any {
  if (feature.types.includes("temperature") && !feature.types.includes("target")) {
    return roundToMaxOneDecimalPlace(parseInt(String(fritzdevice.temperature.celsius)) / 10);
  }
  if (feature.types.includes("temperature") && feature.types.includes("target")) {
    return roundToMaxOneDecimalPlace(parseInt(String(fritzdevice.hkr.tsoll)) / 2);
  }
  if (feature.types.includes("battery")) {
    return parseInt(String(fritzdevice.battery));
  }
  if (feature.types.includes("power")) {
    return roundToMaxOneDecimalPlace(parseInt(String(fritzdevice.powermeter.power)) / 1000);
  }
  if (feature.types.includes("voltage")) {
    return roundToMaxOneDecimalPlace(parseInt(String(fritzdevice.powermeter.voltage)) / 1000);
  }
  if (feature.types.includes("switch")) {
    return fritzdevice.switch.state == "1";
  }

  // Handle other feature types if needed
  return null;
}

async function updateDeviceData(deviceId: string, setDataOption: any): Promise<void> {
  await parentAction("setData", { deviceId, options: setDataOption });
}

async function processUnkownDevice(fritzdevice: any): Promise<void> {
  let icon: string = "";
  let features: any = [];
  let conf: any = {};

  console.log("Processing unknown device:", fritzdevice.identifier);

  if (fritzdevice.identifier.startsWith("09995")) {
    icon = "mdi-radiator";
    features = getTemperatureFeatures();
    conf = {
      identifier: fritzdevice.identifier,
      absenk: fritzdevice.hkr.absenk,
      komfort: fritzdevice.hkr.komfort,
    };
  }

  if (fritzdevice.identifier.startsWith("08761")) {
    icon = "mdi-power-cycle";
    features = getPowerFeatures();
    conf = {
      identifier: fritzdevice.identifier,
    };
  }

  if (icon) {
    const deviceData = createDeviceData(fritzdevice, icon, features, conf);
    const res = await upsertDevice(null, deviceData);

    if (res && res._id) {
      console.log("New device created successfully. Updating maps...");
      devicesMap.set(res._id, res);
      identifierToDeviceIdMap.set(fritzdevice.identifier, res._id);
    }
  }
}

function getTemperatureFeatures(): any[] {
  return [
    {
      name: "Temperature",
      category: "sensor",
      verifyvalue: "^(-?[4-9]\\d|\\d{2})(\\.\\d{1,2})?$|^80(\\.00)?$",
      types: ["temperature"],
      unit: "°C",
      icon: "eva-thermometer",
    },
    {
      name: "Battery",
      category: "sensor",
      verifyvalue: "^(100|0|[1-9][0-9]?)$",
      types: ["percent", "battery"],
      unit: "%",
      icon: "eva-battery-outline",
    },
    {
      name: "Target temperature",
      category: "action",
      verifyvalue: "^(-?[4-9]\\d|\\d{2})(\\.\\d{1,2})?$|^80(\\.00)?$",
      types: ["temperature", "target"],
      unit: "°C",
      icon: "eva-thermometer-plus",
    },
  ];
}

function getPowerFeatures(): any[] {
  return [
    {
      name: "Temperature",
      category: "sensor",
      verifyvalue: "^(-?[4-9]\\d|\\d{2})(\\.\\d{1,2})?$|^80(\\.00)?$",
      types: ["temperature"],
      unit: "°C",
      icon: "eva-thermometer",
    },
    {
      name: "Voltage",
      category: "sensor",
      verifyvalue: "^(400|0|[1-9]\\d{0,2}|[1-3]\\d{3})(\\.\\d{1,2})?$",
      types: ["voltage"],
      unit: "V",
      icon: "mdi-lightning-bolt-outline",
    },
    {
      name: "Power",
      category: "sensor",
      verifyvalue: "^(?:\\d|[1-9]\\d{1,2}|[1-2]\\d{3}|3[0-5]\\d{2}|3600)(?:\\.\\d{1,2})?$",
      types: ["power"],
      unit: "W",
      icon: "o_power",
    },
    {
      name: "Switch",
      category: "action",
      verifyvalue: "^(?:true|false)$",
      types: ["switch", "boolean"],
      icon: "eva-power-outline",
    },
  ];
}

function createDeviceData(fritzdevice: any, icon: string, features: any[], conf: any): any {
  return {
    name: fritzdevice.name,
    icon,
    features,
    driver: null,
    manufacturer: fritzdevice.manufacturer,
    firmwareVersion: fritzdevice.fwversion,
    deviceModel: fritzdevice.productname,
    conf,
  };
}

async function upsertDevice(device: any, deviceData: any): Promise<any> {
  return await parentAction("upsertDevice", { device: null, deviceData });
}

async function parseXml(xmlData: string): Promise<any> {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
  return new Promise((resolve, reject) => {
    parser.parseString(xmlData, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

async function main(fritz_url: string, username: string, password: string) {
  await getFritzBoxSID();
  await getSmartHomeDevices();
  setInterval(getSmartHomeDevices, 60 * 1000);
}

/**
 *  - - - - DO NOT REMOVE OR RENAME THIS FUNCTION (handleRealtimeDeviceValue) - - - -
 *
 * This function handles the change in a device's feature value in real-time.
 * @param deviceId - The ID of the device whose feature value has changed.
 * @param featureId - The ID of the feature whose value has changed.
 * @param values - An object containing the old and new values of the feature.
 */
async function handleRealtimeDeviceValue(
  deviceId: string,
  featureId: string,
  values: { oldvalue: any; newvalue: any }
) {
  const { oldvalue, newvalue } = values;
  let device = getDevice(deviceId);
  let feature = getFeature(deviceId, featureId);
  if (!device || !feature) return;

  if (device.conf && device.conf.identifier) {
    if (feature.types.includes("temperature") && oldvalue != newvalue) {
      await setFritzBoxParameter("sethkrtsoll", device.conf.identifier, Math.round(newvalue * 2));
    }
    if (feature.types.includes("switch") && oldvalue != newvalue) {
      if (newvalue) {
        await setFritzBoxParameter("setswitchon", device.conf.identifier);
      } else {
        await setFritzBoxParameter("setswitchoff", device.conf.identifier);
      }
    }
  }
}

function roundToMaxOneDecimalPlace(num) {
  const roundedNum = Math.round((num + Number.EPSILON) * 10) / 10;
  return roundedNum % 1 === 0 ? Math.round(roundedNum) : roundedNum;
}

if (!isMainThread) {
  if (fritzbox_addon_url && fritzbox_addon_user && fritzbox_addon_password) {
    try {
      main(fritzbox_addon_url, fritzbox_addon_user, fritzbox_addon_password);
    } catch {}
  }
}
