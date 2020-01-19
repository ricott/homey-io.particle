'use strict';

const Homey = require('homey');
const Particle = require('particle-api-js');
const EventCounter = require('../../lib/counter.js');

class HeaterDevice extends Homey.Device {

  onInit() {
    this.log('Device initiated', this.getName());

    this.pollIntervals = [];
    this.refresh_interval = this.getSettings().refresh_interval || 60;
    this.compressorCounter = new EventCounter(24 * 60 * 60 * 1000);
    this.fanCounter = new EventCounter(24 * 60 * 60 * 1000);
    this.immersionHeaterhCounter = new EventCounter(24 * 60 * 60 * 1000);

    this.device = {
      id: this.getData().id,
      name: this.getName(),
      info: null,
      eventStream: null
    };

    //Values are refreshed continously
    this.refreshCloudDeviceStatus();

    this._initilializeTimers();

    this._startDeviceEventListener();
  }

  _startDeviceEventListener() {
    var self = this;
    self.log('Starting device event listener');

    new Particle().getEventStream({ deviceId: this.device.id, auth: Homey.ManagerSettings.get('access_token') })
      .then(function (stream) {
        self.device.eventStream = stream;
        stream.on('event', function (event) {
          self.onHeaterMessage(self, event);
        });
      });
  }

  onHeaterMessage(self, event) {
    if (event.name == 'house/ivt/data') {
      //this.log(`Data received: ${event.data}`);
      let data = JSON.parse(event.data);

      self.handleCompressorStatus(self, data.compressor_on);
      self.handleFanStatus(self, data.fan_on);
      self.handleIHStatus(self, data.immersion_heater_on);

      self._updateProperty("measure_temperature.floor_water", parseFloat(data.floor_water_temp.toFixed(2)));
      self._updateProperty("measure_temperature.outdoor", parseFloat(data.outdoor_temp.toFixed(2)));
      self._updateProperty("measure_temperature.indoor", parseFloat(data.indoor_temp.toFixed(2)));
      self._updateProperty("heater_state", self.resolveHeaterStateDescription(data.heater_state));

      self._updateProperty("starts.compressor", self.compressorCounter.numberOfEvents());
      self._updateProperty("runtime.compressor", self.compressorCounter.averageRunTimePretty());
      self._updateProperty("starts.fan", self.fanCounter.numberOfEvents());
      self._updateProperty("runtime.fan", self.fanCounter.averageRunTimePretty());
      self._updateProperty("starts.immersion_heater", self.immersionHeaterhCounter.numberOfEvents());
      self._updateProperty("runtime.immersion_heater", self.immersionHeaterhCounter.averageRunTimePretty());
    }
  }

  handleIHStatus(self, status) {
    let ihStatus = (status === 1) ? "On" : "Off";

    if (self.isCapabilityValueChanged('status.immersion_heater', ihStatus)) {
      if (ihStatus === 'On') {
        self.log('Immersion Heater turned on');
        self.immersionHeaterhCounter.startEvent();
      } else {
        self.log('Immersion Heater turned off');
        self.immersionHeaterhCounter.stopEvent();
      }
    }
    self._updateProperty("status.immersion_heater", ihStatus);
  }

  handleFanStatus(self, status) {
    let fanStatus = (status === 1) ? "On" : "Off";

    if (self.isCapabilityValueChanged('status.fan', fanStatus)) {
      if (fanStatus === 'On') {
        self.log('Fan turned on');
        self.fanCounter.startEvent();
      } else {
        self.log('Fan turned off');
        self.fanCounter.stopEvent();
      }
    }
    self._updateProperty("status.fan", fanStatus);
  }

  handleCompressorStatus(self, status) {
    let compressorStatus = (status === 1) ? "On" : "Off";

    if (self.isCapabilityValueChanged('status.compressor', compressorStatus)) {
      if (compressorStatus === 'On') {
        self.log('Compressor turned on');
        self.compressorCounter.startEvent();
      } else {
        self.log('Compressor turned off');
        self.compressorCounter.stopEvent();
      }
    }
    self._updateProperty("status.compressor", compressorStatus);
  }

  resolveHeaterStateDescription(state) {
    let heaterState = Homey.__('heater_state.unknown');
    if (state === -1) {
      heaterState = Homey.__('heater_state.disabled');
    } else if (state === 0) {
      heaterState = Homey.__('heater_state.standard');
    } else if (state === 1) {
      heaterState = Homey.__('heater_state.heating');
    } else if (state === 2) {
      heaterState = Homey.__('heater_state.forced_heating');
    }
    return heaterState;
  }

  _stopDeviceEventListener() {
    if (this.device.eventStream) {
      this.log('Stopping device event listener');
      this.device.eventStream.abort();
      this.device.eventStream = undefined;
    }
  }

  _restartDeviceEventListener() {
    this._stopDeviceEventListener();
    this._startDeviceEventListener();
  }

  _initilializeTimers() {
    this.log('Adding timers');
    // Start a poller, to check the device status
    this.pollIntervals.push(setInterval(() => {
      this.refreshCloudDeviceStatus();
    }, this.refresh_interval * 1000));

    //Clean out old entries in counters
    this.pollIntervals.push(setInterval(() => {
      this.counterMaintenance();
    }, 60 * 60 * 1000)); //1h
  }

  _deleteTimers() {
    //Kill interval object(s)
    this.log('Removing timers');
    this.pollIntervals.forEach(timer => {
      clearInterval(timer);
    });
  }

  _reinitializeTimers() {
    this._deleteTimers();
    this._initilializeTimers();
  }

  onDeleted() {
    this.log(`Deleting device '${this.getName()}' from Homey.`);
    this._deleteTimers();
    this._stopDeviceEventListener();
    this.device = null;
  }

  onRenamed(name) {
    this.log(`Renaming device from '${this.device.name}' to '${name}'`)
    this.device.name = name;
  }

  counterMaintenance() {
    this.log('Running counter maintenance');
    this.compressorCounter.cleanOldEvents();
    this.fanCounter.cleanOldEvents();
    this.immersionHeaterhCounter.cleanOldEvents();
  }

  refreshCloudDeviceStatus() {
    var self = this;
    new Particle().getDevice({ deviceId: this.device.id, auth: Homey.ManagerSettings.get('access_token') })
      .then(
        function (data) {
          let device = data.body;

          //Update capabilities of cloud device
          self._updateProperty('connected', device.connected);

          self.device.info = device;

          let lastHeardDate = new Date(device.last_heard)
            .toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });

          //Update Homey settings in advanced tab
          self.setSettings({
            serial_number: device.serial_number,
            firmware_version: device.system_firmware_version,
            last_ip_address: device.last_ip_address,
            last_heard: lastHeardDate
          })
            .catch(err => {
              self.error('failed to update settings', err);
            });

        },
        function (err) {
          self.log('Failed to refresh device status: ', err);
        }
      );
  }

  _updateProperty(key, value) {
    if (this.isCapabilityValueChanged(key, value)) {
      this.log(`[${this.getName()}] Updating capability '${key}' from '${this.getCapabilityValue(key)}' to '${value}'`);
      this.setCapabilityValue(key, value);

      let tokens = {};
      if (key == 'connected') {
        let deviceTrigger = 'trigger.device_connected';
        if (value === false) {
          deviceTrigger = 'trigger.device_disconnected';
        }
        this.getDriver().triggerFlow(deviceTrigger, tokens, this);

        /*        tokens = {
                  serial: this.getSettings().serial_number,
                  name: this.getName(),
                  ip_address: this.getSettings().last_ip_address
                }
                this.getDriver().triggerFlow(conditionTrigger, tokens, this);*/
      }
    } else {
      //Update value to refresh timestamp in app
      this.setCapabilityValue(key, value);
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

  async onSettings(oldSettings, newSettings, changedKeysArr) {
    if (changedKeysArr.indexOf("refresh_interval") > -1) {
      this.log('Refresh interval value was change to:', newSettings.refresh_interval);
      this.refresh_interval = newSettings.refresh_interval;
      //We also need to re-initialize the timer
      this._reinitializeTimers();
    }
  }

}

module.exports = HeaterDevice;
