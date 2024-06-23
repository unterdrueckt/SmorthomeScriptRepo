import { parentPort, isMainThread, workerData } from "worker_threads";
import { MqttClient, connect } from "mqtt";

interface exposesInterface {
  access: number;
  category: string;
  description: string;
  label: string;
  name: string;
  property: string;
  type: string;
  values?: unknown;
  unit?: string;
  value_max?: number;
  value_min?: number;
}

interface zDMInterface {
  friendly_name: string;
  description: string;
  ieee_address: string;
  manufacturer: string;
  model_id: string;
  model: string;
  network_address: number;
  power_source: string;
  software_build_id: string;
  type: string;
  exposes: Array<exposesInterface>;
  availability_state: string;
}

if (!isMainThread) {
  let zigbeeDeviceMap = new Map<string, zDMInterface>();

  function getDeviceIdFromTopic(topic) {
    const parts = topic.split("/");
    if (parts.length >= 2 && parts[0] === "zigbee2mqtt") {
      return parts[1]; // Return the device ID part
    }
    return null; // Return null if the topic does not match the expected format
  }

  function mqttHandler(topic: string, message: Buffer) {
    try {
      const messageJson = JSON.parse(message.toString());
      const deviceName = getDeviceIdFromTopic(topic);
      if (topic == "zigbee2mqtt/bridge/devices") {
        messageJson.forEach((device: any) => {
          if (
            !zigbeeDeviceMap.has(device.friendly_name) ||
            zigbeeDeviceMap.get(device.friendly_name)?.software_build_id != device.software_build_id
          ) {
            const zdmInterface: zDMInterface = {
              friendly_name: device.friendly_name,
              description: device.definition?.description,
              ieee_address: device.ieee_address,
              vendor: device.definition?.vendor,
              manufacturer: device.manufacturer,
              model_id: device.model_id,
              model: device.definition?.model,
              network_address: device.network_address,
              power_source: device.power_source,
              software_build_id: device.software_build_id,
              type: device.type,
              exposes: device.definition?.exposes,
              availability_state: "unkown",
            } as any;

            zigbeeDeviceMap.set(zdmInterface.friendly_name, zdmInterface);
          }
        });
        if (messageJson.length) console.log(`Got z2m device info data for ${messageJson.length} new devices`);
      } else if (deviceName && zigbeeDeviceMap.has(deviceName)) {
        if (topic.includes("request")) {
          if (mqttClient?.connected) {
            try {
              mqttClient.publish(
                `zigbee2mqtt/${deviceName}/deviceinfos`,
                JSON.stringify(zigbeeDeviceMap.get(deviceName))
              );
              console.log(`Got request for device info for device ${deviceName}`);
            } catch (err) {
              console.error(`MQTT send infos error: ${err}`);
            }
          } else {
            console.error("MQTT not connected! Cannot send Infos.");
          }
        } else if (topic.includes("availability")) {
          let deviceObj = zigbeeDeviceMap.get(deviceName) as any;
          deviceObj.availability_state = messageJson?.state || "unkown";
          zigbeeDeviceMap.set(deviceName, deviceObj);
        }
      }
    } catch {}
  }

  let mqttClient: MqttClient | undefined;

  const mqttURI = workerData?.system?.config?.MQTT?.broker as string;
  const mqttUriPattern = /^(mqtt(s)?:\/\/(?:[a-zA-Z0-9.-]+|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}))(?::(\d{1,5}))?$/;

  if (mqttUriPattern.test(mqttURI)) {
    mqttClient = connect(mqttURI, {
      reconnectPeriod: 1000,
    });

    mqttClient.on("connect", () => {
      console.log(`Connected to MQTT broker ${mqttURI}`);
      if (mqttClient?.connected) {
        try {
          mqttClient.subscribe("zigbee2mqtt/bridge/devices");
          mqttClient.subscribe("zigbee2mqtt/+/request/deviceinfos");
          mqttClient.subscribe("zigbee2mqtt/+/availability");
          mqttClient.on("message", mqttHandler);
        } catch (err) {
          console.error(`MQTT init error: ${err}`);
        }
      } else {
        console.error("MQTT not connected!");
      }
    });

    mqttClient.on("reconnect", () => {
      console.log(`Reconnecting to MQTT broker ${mqttURI}`);
    });

    mqttClient.on("error", (err) => {
      console.error(`MQTT error: ${err}`);
    });

    mqttClient.on("offline", () => {
      console.error(`MQTT client offline`);
    });

    mqttClient.on("close", () => {
      console.error(`MQTT connection closed`);
    });
  }
  if (!mqttClient) {
    console.error(`No mqttClient!`);
    process.exit(1);
  }
}
