
const Storage = require("Storage");

const PumpController = {
  addr: A0,
  running: false,
  timeoutId: null,
  setTimeoutId: function(id) {
    this.timeoutId = id;
  },
  isRunning: function() {
    return this.running;
  },
  toggleRun: function(duration) {
    this.running = true;
    digitalWrite(this.addr, true);
    const timeoutId = setTimeout(this.toggleStop.bind(this), duration);
    this.setTimeoutId(timeoutId);
  },
  toggleStop: function() {
    if (!this.isRunning()) {
      return;
    }
    this.running = false;
    digitalWrite(this.addr, false);
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }
};

const LightController = {
  lights: {
    "1": {addr: B13, state: false},
    "2": {addr: B14, state: false},
    "3": {addr: B15, state: false}
  },
  intervals: [],
  isActive: false,
  run: function(cmd, args) {
    this.stopAll();
    this.isActive = true;
    const interval = this[cmd].apply(this, Array.isArray(args) ? args : [args]);
    this.intervals.push(interval);
  },
  stopAll: function() {
    this.intervals.forEach(interval => interval && clearInterval(interval));
    this.intervals = [];
    this.toggleMultiple(["1", "2", "3"], false);
    this.isActive = false;
  },
  pulseLight: function (lightNo, coeff) {
    this.lights[lightNo].state = coeff !== 0;
    analogWrite(this.lights[lightNo].addr, coeff);
  },
  pulseLights: function (lightArr, coeff) {
    lightArr.forEach((lightNo) => this.pulseLight(lightNo, coeff));
  },
  toggleMultiple: function(arr, val) {
    arr.forEach((lightNo) => this.toggleLight(lightNo, val));
  },
  toggleLight: function (lightNo, val) {
    if (typeof val !== "undefined") {
      this.lights[lightNo].state = val;
    } else {
      this.lights[lightNo].state = !this.lights[lightNo].state;
    }

    analogWrite(this.lights[lightNo].addr, this.lights[lightNo].state ? 0.5 : 0);
  },
  blink: function(times, lights) {
    const defaultTimes = times || 1;
    const defaultLights = lights || ["1", "2", "3"];
    let cycles = defaultTimes * 2;
    const interval = setInterval(() => {
      if (cycles === 0) {
        this.stopAll();
        return;
      }
      cycles--;
      this.toggleMultiple(defaultLights);

    }, 500);
    return interval;
  },
  slowBlink: function(times) {
    let lambda = 0;
    let flip = false;
    const range = 20;
    const cycles = times || 1;
    const iterations = cycles * range * 2;

    const interval = setInterval(() => {
      lambda++;
      const remainder = lambda % range;

      if (remainder === 0) {
        flip = !flip;
      }

      const diff = flip ? range - remainder : remainder;
      
      this.pulseLights(["1", "2", "3"], diff / 100);

      if (lambda === iterations) {
        this.stopAll();
      }
    }, 50);

    return interval;
  },
  runner: function(unit) {
    this.stopAll();
    const defaultUnit = 50;
    const actualUnit = unit || defaultUnit;
    const freq = actualUnit * 4;
    const light1 = setInterval(() => {
      this.toggleLight("3");
    },freq);
    this.intervals.push(light1);

    setTimeout(() => {
      const light2 = setInterval(() => {
        this.toggleLight("2");
      }, freq);
      this.intervals.push(light2);
    }, actualUnit);
    setTimeout(() => {
      const light3 = setInterval(() => {
        this.toggleLight("1");
      }, freq);
      this.intervals.push(light3);
    }, actualUnit * 2);
  },
  progressBar: function(percentage) {
    const third = 33;
    const coeffs = [];
    const fullLights = parseInt(percentage / third);
    const partialLights = parseInt((percentage % third) / third * 100) / 100;


    if (fullLights > 0) {
      coeffs.push(1);
    }

    if (fullLights > 1) {
      coeffs.push(1);
    }

    if (fullLights > 2) {
      coeffs.push(1);
    } else {
      coeffs.push(partialLights);
    }

    coeffs.forEach((coeff, index) => {
      this.pulseLight((index + 1).toString(), coeff / 2);
    });
  },
  runProgressBar: function(duration) {
    const start = parseInt(Date.now());
    const interval = setInterval(() => {
      const diff = parseInt(Date.now()) - start;
      if (diff >= duration) {
        clearInterval(interval);
        this.run("blink", 3);
      }
      this.progressBar(parseInt(diff / duration * 100));
    }, 50);

    return interval;
  }
};

const TimeController = {
  currentTimeFilename: "currentTime",
  wateringDataFilename: "wateringData",
  lastWateredTime: new Date(),
  wateringCounter: 0,
  setGlobalTime: function(dateParam) {
    const date = new Date(dateParam);
    setTime(date.getTime() / 1000);
    Storage.writeJSON(this.currentTimeFilename, {
      "timestamp": date.toJSON()
    });
  },
  writeCurrentTime: function() {
    Storage.writeJSON(this.currentTimeFilename, {
      "timestamp": new Date().toJSON()
    });
  },
  readCurrentTime: function() {
    E.setTimeZone(1);
    const currentTime = Storage.readJSON(this.currentTimeFilename, true);
    if (currentTime) {
      setTime(new Date(currentTime.timestamp).getTime()/1000 + 3600);
      // for some reason, a drift of 1h occurs at this point
    }
  },
  writeWateringData: function() {
    this.lastWateredTime = new Date();
    Storage.writeJSON(this.wateringDataFilename, {
      "timestamp": this.lastWateredTime.toJSON(),
      "counter": ++this.wateringCounter
    });
  },
  readLastWateringTime: function() {
    const data = Storage.readJSON(this.wateringDataFilename, true);

    if (data) {
      this.wateringCounter = data.counter;
      this.lastWateredTime = new Date(data.timestamp);
    }

    // run check if counter * watering amount >= total tank capacity
    // then shut down with setDeepSleep(1);
  },
  checkForWateringTime: function(period) {
    if (this.wateringCounter > 20) {
      return false;
    }

    const currDate = new Date();
    if (currDate.getTime() - this.lastWateredTime.getTime() >= period) {
      return true;
    }

    return false;
  },
  resetWateringTime: function() {
    this.wateringCounter = -1;
    this.writeWateringData();
  }
};

const GlobalController = {
  buttonDownTimestamp: null,
  lightTimeout: null,
  WATERING_PERIOD: 3600000, // 2 days
  DURATION_500ML: 25000,
  DURATION_100ML: 5000,
  pumpRoutine: function(duration) {
    PumpController.toggleRun(duration);
    LightController.run("runProgressBar", duration);
  
    this.lightTimeout = setTimeout(() => {
      LightController.run("blink", 3);
    }, duration);
  },
  handleButtonDown: function() {
    this.buttonDownTimestamp = Date.now();
  },

  handleButtonUp: function() {
    const diff = parseInt(Date.now() - this.buttonDownTimestamp);
  
    if (diff < 3000) {
      if(PumpController.isRunning() === true) {
        PumpController.toggleStop();
        LightController.stopAll();
        clearTimeout(this.lightTimeout);
        return;
      }  
      this.pumpRoutine(this.DURATION_100ML);
    } else {
      TimeController.resetWateringTime();
      LightController.run("blink", 5);
    }
  }
};

function startup() {
  LightController.pulseLights(["1", "2", "3"], 0.1);
  setTimeout(() => {
    TimeController.readCurrentTime();
    TimeController.readLastWateringTime();

    setWatch(GlobalController.handleButtonDown.bind(GlobalController), BTN1, { repeat: true, edge: "rising" });
    setWatch(GlobalController.handleButtonUp.bind(GlobalController), BTN1, { repeat: true, edge: "falling" });

    LightController.run("slowBlink", 5);

    setInterval(() => {
      if (LightController.isActive === false) {
        LightController.run("blink", [1, [Math.ceil(Math.random() * 3).toString()]]);
      }
      TimeController.writeCurrentTime();

      if(TimeController.checkForWateringTime(GlobalController.WATERING_PERIOD) && !PumpController.isRunning()) {
        GlobalController.pumpRoutine(GlobalController.DURATION_500ML);
        TimeController.writeWateringData();
      }
    }, 30000);
  }, 10000);
}

function onInit(){
  startup();
}

save();