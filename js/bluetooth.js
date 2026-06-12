/* ====================================================================
   PadelBluetooth — Web Bluetooth handling for the physical buttons.

   Each physical button is a BLE peripheral advertising the name
   "PadelButton". When its button characteristic notifies, we emit a
   "press" for the team that device is bound to.

   The manager holds a slot per team so a SECOND device (the opposing
   team's button) can be added later with zero changes to the UI:
       bt.connect(0)   // connect a device and bind it to Team A
       bt.connect(1)   // connect a device and bind it to Team B

   Replace the UUIDs below with the firmware's real service/characteristic.
   As a convenient default we listen on the standard Battery Service so
   the scaffold is testable against common dev boards; swap to the custom
   service when the hardware firmware is ready.
   ==================================================================== */
(function (global) {
  "use strict";

  // ---- Adjust these to match the PadelButton firmware ----------------
  const DEVICE_NAME = "PadelButton";

  // Custom GATT profile (placeholder UUIDs — replace with real ones).
  const BUTTON_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb";
  const BUTTON_CHAR     = "0000ffe1-0000-1000-8000-00805f9b34fb";

  // Optional well-known services to also request access to (helps when
  // testing against generic dev kits). Safe to leave as-is.
  const OPTIONAL_SERVICES = [BUTTON_SERVICE, "battery_service", "device_information"];

  const STATUS = { OFF: "off", CONNECTING: "connecting", ON: "on" };

  class DeviceSlot {
    constructor(team) {
      this.team = team;
      this.device = null;
      this.server = null;
      this.characteristic = null;
      this.status = STATUS.OFF;
      this.name = null;
    }
  }

  class PadelBluetooth {
    constructor() {
      this.slots = [new DeviceSlot(0), new DeviceSlot(1)];
      this._handlers = { press: [], status: [] };
      this._boundNotify = this._onNotify.bind(this);
      this._boundDisconnect = this._onDisconnect.bind(this);
    }

    static get supported() {
      return typeof navigator !== "undefined" && !!navigator.bluetooth;
    }

    on(event, cb) { if (this._handlers[event]) this._handlers[event].push(cb); }
    _emit(event, payload) { (this._handlers[event] || []).forEach(cb => cb(payload)); }

    statusOf(team) { return this.slots[team].status; }

    _setStatus(team, status) {
      this.slots[team].status = status;
      this._emit("status", { team, status, name: this.slots[team].name });
    }

    /* ----- connect & bind a device to a team ----------------------- */
    async connect(team) {
      if (!PadelBluetooth.supported) {
        throw new Error("Web Bluetooth is not supported in this browser.");
      }
      const slot = this.slots[team];
      this._setStatus(team, STATUS.CONNECTING);
      try {
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ name: DEVICE_NAME }],
          optionalServices: OPTIONAL_SERVICES
        });

        slot.device = device;
        slot.name = device.name || DEVICE_NAME;
        device.addEventListener("gattserverdisconnected", () => this._boundDisconnect(team));

        const server = await device.gatt.connect();
        slot.server = server;

        const characteristic = await this._resolveCharacteristic(server);
        slot.characteristic = characteristic;

        characteristic.addEventListener("characteristicvaluechanged", (e) =>
          this._boundNotify(team, e));
        await characteristic.startNotifications();

        this._setStatus(team, STATUS.ON);
        return slot.name;
      } catch (err) {
        this._setStatus(team, STATUS.OFF);
        throw err;
      }
    }

    // Resolve the notify characteristic, falling back gracefully so the
    // scaffold works against the custom service or a generic dev board.
    async _resolveCharacteristic(server) {
      try {
        const service = await server.getPrimaryService(BUTTON_SERVICE);
        return await service.getCharacteristic(BUTTON_CHAR);
      } catch (e) {
        // Fallback: first notifiable characteristic on the first service.
        const services = await server.getPrimaryServices();
        for (const svc of services) {
          const chars = await svc.getCharacteristics();
          const notif = chars.find(c => c.properties.notify || c.properties.indicate);
          if (notif) return notif;
        }
        throw new Error("No notify characteristic found on PadelButton.");
      }
    }

    /* ----- notifications ------------------------------------------- */
    _onNotify(team, event) {
      // The firmware may encode click type / battery in the value; for now
      // any notification counts as a single press for this team.
      const value = event.target.value; // DataView
      this._emit("press", { team, value });
    }

    _onDisconnect(team) {
      const slot = this.slots[team];
      slot.server = null;
      slot.characteristic = null;
      this._setStatus(team, STATUS.OFF);
    }

    async disconnect(team) {
      const slot = this.slots[team];
      try {
        if (slot.characteristic) await slot.characteristic.stopNotifications();
        if (slot.device && slot.device.gatt.connected) slot.device.gatt.disconnect();
      } catch (e) { /* ignore */ }
      this._onDisconnect(team);
    }

    disconnectAll() { this.slots.forEach((_, i) => this.disconnect(i)); }

    anyConnected() { return this.slots.some(s => s.status === STATUS.ON); }
  }

  PadelBluetooth.STATUS = STATUS;
  global.PadelBluetooth = PadelBluetooth;
})(typeof window !== "undefined" ? window : this);
