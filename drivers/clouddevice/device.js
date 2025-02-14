'use strict';

const Homey = require('homey');
const Particle = require('particle-api-js');

const deviceClass = 'service';

class CloudDevice extends Homey.Device {

  async onInit() {
    this.logMessage('Device initiated');

    // Change device class to service if not already
    if (this.getClass() !== deviceClass) {
      await this.setClass(deviceClass);
    }

    // Register device triggers
    this._device_connected = this.homey.flow.getDeviceTriggerCard('device_connected');
    this._device_disconnected = this.homey.flow.getDeviceTriggerCard('device_disconnected');
    this._device_event = this.homey.flow.getDeviceTriggerCard('device_event');

    this.device = {
      info: null,
      functions: [],
      variables: [],
      eventStream: null
    };

    await this.refreshCloudDeviceActionsAndVariables();

    //Values are refreshed continously
    await this.refreshCloudDeviceStatus();

    this._initilializeTimers();

    await this._startDeviceEventListener(this.getSetting('generate_device_events'));
  }

  logMessage(message) {
    this.log(`[${this.getName()}] ${message}`);
  }

  async _startDeviceEventListener(generateDeviceEvents) {
    if (generateDeviceEvents === 'yes') {
      this.logMessage('Starting device event listener');

      try {
        const stream = await new Particle().getEventStream({
          deviceId: this.getData().id,
          auth: this.homey.settings.get('access_token')
        });

        this.device.eventStream = stream;
        stream.on('event', (event) => {
          const particleEvent = {
            event_name: event.name || 'unknown',
            event_value: event.data || 'unknown'
          };
          this._device_event.trigger(this, particleEvent, {}).catch(error => { this.error(error) });
        });
      } catch (error) {
        this.error('Failed to start event listener:', error);
      }
    }
  }

  _stopDeviceEventListener() {
    if (this.device.eventStream) {
      this.logMessage('Stopping device event listener');
      this.device.eventStream.abort();
      this.device.eventStream = undefined;
    }
  }

  _restartDeviceEventListener(generateDeviceEvents) {
    this._stopDeviceEventListener();
    this._startDeviceEventListener(generateDeviceEvents);
  }

  _initilializeTimers() {
    this.logMessage('Adding timers');
    // Start a poller, to check the device status
    this.homey.setInterval(() => {
      this.refreshCloudDeviceStatus();
    }, this.getSetting('refresh_interval') * 1000);
  }

  onDeleted() {
    this.logMessage('Deleting device from Homey.');
    this._stopDeviceEventListener();
    this.device = null;
  }

  async refreshCloudDeviceActionsAndVariables() {
    this.logMessage('Refreshing device actions and variables');

    try {
      const data = await new Particle().getDevice({
        deviceId: this.getData().id,
        auth: this.homey.settings.get('access_token')
      });

      const device = data.body;
      const deviceVariables = [];

      if (device.variables) {
        Object.keys(device.variables).forEach(key => {
          deviceVariables.push({
            id: this.getData().id,
            name: key,
            type: device.variables[key]
          });
        });
      }
      this.device.variables = deviceVariables;

      const deviceFunctions = [];
      if (device.functions != null && device.functions.length > 0) {
        device.functions.forEach(func => {
          deviceFunctions.push({
            id: this.getData().id,
            name: func,
            device_name: this.getName()
          });
        });
      }
      this.device.functions = deviceFunctions;
    } catch (err) {
      this.logMessage('Failed to refresh device variables and functions: ' + err);
    }
  }

  async getDeviceVariableValue(variableName) {
    //If device is offline then we cant invoke a function
    if (!this.device.info.connected) {
      return null;
    }

    try {
      const data = await new Particle().getVariable({
        deviceId: this.getData().id,
        name: variableName,
        auth: this.homey.settings.get('access_token')
      });

      if (data?.body?.result !== null) {
        return data.body.result;
      }
      return null;

    } catch (err) {
      this.logMessage('Variable call failed: ' + err);
      return null;
    }
  }

  async callDeviceFunction(functionName, args) {
    //If device is offline then we cant invoke a function
    if (!this.device.info.connected) {
      return { statusCode: 400 };
    }

    try {
      const data = await new Particle().callFunction({
        deviceId: this.getData().id,
        name: functionName,
        argument: args,
        auth: this.homey.settings.get('access_token')
      });

      return data;

    } catch (err) {
      if (err.statusCode === 400) {
        this.logMessage('Device most likely offline');
        this.logMessage(err.body);
      } else {
        this.error('Function call failed: ', err);
      }
      return { statusCode: err.statusCode || 500 };
    }
  }

  async refreshCloudDeviceStatus() {
    try {
      const data = await new Particle().getDevice({
        deviceId: this.getData().id,
        auth: this.homey.settings.get('access_token')
      });

      const device = data.body;
      //If connected change from false to true we should refresh variables and functions
      if (device.connected && this.isCapabilityValueChanged('connected', device.connected)) {
        this.logMessage('Device came online, lets refresh variables and functions');
        await this.refreshCloudDeviceActionsAndVariables();
      }

      //Update capabilities of cloud device
      this._updateProperty('connected', device.connected);

      this.device.info = device;

      const lastHeardDate = new Date(device.last_heard)
        .toLocaleDateString('en-US', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric'
        });

      //Update Homey settings in advanced tab
      try {
        await this.setSettings({
          serial_number: device.serial_number,
          firmware_version: device.system_firmware_version,
          last_ip_address: device.last_ip_address,
          last_heard: lastHeardDate
        });
      } catch (settingsErr) {
        this.error('failed to update settings', settingsErr);
      }

    } catch (err) {
      this.error('Failed to refresh device status: ', err);
    }
  }

  _updateProperty(key, value) {
    let self = this;
    if (self.isCapabilityValueChanged(key, value)) {
      self.logMessage(`Updating capability '${key}' from '${self.getCapabilityValue(key)}' to '${value}'`);
      self.setCapabilityValue(key, value)
        .then(function () {

          let tokens = {};
          if (key == 'connected') {
            let flowTrigger;
            if (value === true) {
              self._device_connected.trigger(self, tokens, {}).catch(error => { self.error(error) });
              flowTrigger = 'a_device_connected';
            } else {
              self._device_disconnected.trigger(self, tokens, {}).catch(error => { self.error(error) });
              flowTrigger = 'a_device_disconnected';
            }

            tokens = {
              serial: self.getSettings().serial_number,
              name: self.getName(),
              ip_address: self.getSettings().last_ip_address
            }
            self.driver.triggerFlow(flowTrigger, tokens);
          }

        }).catch(reason => {
          self.error(reason);
        });
    } else {
      self.setCapabilityValue(key, value)
        .catch(reason => {
          self.error(reason);
        });
    }
  }

  isCapabilityValueChanged(key, value) {
    let oldValue = this.getCapabilityValue(key);
    //If oldValue===null then it is a newly added device, lets not trigger flows on that
    if (oldValue !== null && oldValue != value) {
      return true;
    } else {
      return false;
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.indexOf("refresh_interval") > -1) {
      this.logMessage(`Refresh interval value was change to '${newSettings.refresh_interval}'`);
    }

    if (changedKeys.indexOf("generate_device_events") > -1) {
      this.logMessage(`Generate device events was change to '${newSettings.generate_device_events}'`);
      this._restartDeviceEventListener(newSettings.generate_device_events);
    }
  }

}

module.exports = CloudDevice;
