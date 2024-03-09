// let the editor know that `Chart` is defined by some code
// included in another file (in this case, `index.html`)
// Note: the code will still work without this line, but without it you
// will see an error in the editor
/* global THREE */
/* global TransformStream */
/* global TextEncoderStream */
/* global TextDecoderStream */
"use strict";

import * as THREE from "three";
import { OBJLoader } from "objloader";

/**
 * @type {Worker}
 */
let worker;
let isConnected = false;
let showCalibration = false;
let errorLoadingModel = true;

let orientation = [0, 0, 0];
let quaternion = [1, 0, 0, 0];
let calibration = [0, 0, 0, 0];

const maxLogLength = 100;
const baudRates = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000, 2000000,
];
const log = document.getElementById("log");
const butConnect = document.getElementById("butConnect");
const butClear = document.getElementById("butClear");
const baudRate = document.getElementById("baudRate");
const autoscroll = document.getElementById("autoscroll");
const showTimestamp = document.getElementById("showTimestamp");
const angleType = document.getElementById("angle_type");
const lightSS = document.getElementById("light");
const darkSS = document.getElementById("dark");
const darkMode = document.getElementById("darkmode");
const canvas = document.querySelector("#canvas");
const calContainer = document.getElementById("calibration");
const logContainer = document.getElementById("log-container");

fitToContainer(canvas);

function fitToContainer(canvas) {
  // Make it visually fill the positioned parent
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  // ...then set the internal size to match
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}

document.addEventListener("DOMContentLoaded", async () => {
  butConnect.addEventListener("click", clickConnect);
  butClear.addEventListener("click", clickClear);
  autoscroll.addEventListener("click", clickAutoscroll);
  showTimestamp.addEventListener("click", clickTimestamp);
  baudRate.addEventListener("change", changeBaudRate);
  angleType.addEventListener("change", changeAngleType);
  darkMode.addEventListener("click", clickDarkMode);

  if ("serial" in navigator) {
    const notSupported = document.getElementById("notSupported");
    notSupported.classList.add("hidden");
  }

  if (isWebGLAvailable()) {
    const webGLnotSupported = document.getElementById("webGLnotSupported");
    webGLnotSupported.classList.add("hidden");
  }

  worker = new Worker("./js/worker.js");
  worker.addEventListener("message", async ({ data }) => {
    const { type, ...body } = data;
    switch (type) {
      case "DATA_READ":
        ({ calibration, orientation, quaternion } = body);
        break;
      case "CONNECTED":
        toggleUIConnected(true);
        break;
      case "DISCONNECTED":
        toggleUIConnected(false);
        break;
      case "LOG_DATA":
        logData(body.line);
        break;
      case "SHOW_CALIBRATION":
        showCalibration = true;
        updateTheme();
        break;
      default:
        break;
    }
  });

  window.addEventListener("resize", onResize);

  initBaudRate();
  loadAllSettings();
  updateTheme();
  onResize();
  await render();
});

document.addEventListener("onBeforeUnload", () => {
  worker.terminate();
});

function logData(line) {
  // Update the Log
  if (showTimestamp.checked) {
    let d = new Date();
    let timestamp =
      d.getHours() +
      ":" +
      `${d.getMinutes()}`.padStart(2, 0) +
      ":" +
      `${d.getSeconds()}`.padStart(2, 0) +
      "." +
      `${d.getMilliseconds()}`.padStart(3, 0);
    log.innerHTML += '<span class="timestamp">' + timestamp + " -> </span>";
    d = null;
  }
  log.innerHTML += line + "<br>";

  // Remove old log content
  if (log.textContent.split("\n").length > maxLogLength + 1) {
    let logLines = log.innerHTML.replace(/(\n)/gm, "").split("<br>");
    log.innerHTML = logLines.splice(-maxLogLength).join("<br>\n");
  }

  if (autoscroll.checked) {
    log.scrollTop = log.scrollHeight;
  }
}

/**
 * @name updateTheme
 * Sets the theme to  Adafruit (dark) mode. Can be refactored later for more themes
 */
function updateTheme() {
  // Disable all themes
  document.querySelectorAll("link[rel=stylesheet].alternate").forEach((styleSheet) => {
    enableStyleSheet(styleSheet, false);
  });

  if (darkMode.checked) {
    enableStyleSheet(darkSS, true);
  } else {
    enableStyleSheet(lightSS, true);
  }

  if (showCalibration && !logContainer.classList.contains("show-calibration")) {
    logContainer.classList.add("show-calibration");
  } else if (!showCalibration && logContainer.classList.contains("show-calibration")) {
    logContainer.classList.remove("show-calibration");
  }
}

function enableStyleSheet(node, enabled) {
  node.disabled = !enabled;
}

/**
 * @name reset
 * Reset the Plotter, Log, and associated data
 */
async function reset() {
  // Clear the data
  log.innerHTML = "";
}

/**
 * @name clickConnect
 * Click handler for the connect/disconnect button.
 */
async function clickConnect() {
  if (isConnected) {
    worker.postMessage({ type: "DISCONNECT" });
    toggleUIConnected(false);
    return;
  }

  await navigator.serial.requestPort();
  worker.postMessage({ type: "CONNECT", baudRate: baudRate.value });
  reset();

  toggleUIConnected(true);
}

/**
 * @name clickAutoscroll
 * Change handler for the Autoscroll checkbox.
 */
async function clickAutoscroll() {
  saveSetting("autoscroll", autoscroll.checked);
}

/**
 * @name clickTimestamp
 * Change handler for the Show Timestamp checkbox.
 */
async function clickTimestamp() {
  saveSetting("timestamp", showTimestamp.checked);
}

/**
 * @name changeBaudRate
 * Change handler for the Baud Rate selector.
 */
async function changeBaudRate() {
  saveSetting("baudrate", baudRate.value);
}

/**
 * @name changeAngleType
 * Change handler for the Baud Rate selector.
 */
async function changeAngleType() {
  saveSetting("angletype", angleType.value);
}

/**
 * @name clickDarkMode
 * Change handler for the Dark Mode checkbox.
 */
async function clickDarkMode() {
  updateTheme();
  saveSetting("darkmode", darkMode.checked);
}

/**
 * @name clickClear
 * Click handler for the clear button.
 */
async function clickClear() {
  reset();
}

async function finishDrawing() {
  return new Promise(requestAnimationFrame);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function convertJSON(chunk) {
  try {
    let jsonObj = JSON.parse(chunk);
    jsonObj._raw = chunk;
    return jsonObj;
  } catch (e) {
    return chunk;
  }
}

function toggleUIConnected(connected) {
  let lbl = "Connect";
  if (connected) {
    lbl = "Disconnect";
  }
  updateTheme();
  isConnected = connected;
  butConnect.textContent = lbl;
}

function initBaudRate() {
  for (let rate of baudRates) {
    var option = document.createElement("option");
    option.text = rate + " Baud";
    option.value = rate;
    baudRate.add(option);
  }
}

function loadAllSettings() {
  // Load all saved settings or defaults
  autoscroll.checked = loadSetting("autoscroll", true);
  showTimestamp.checked = loadSetting("timestamp", false);
  baudRate.value = loadSetting("baudrate", 9600);
  angleType.value = loadSetting("angletype", "quaternion");
  darkMode.checked = loadSetting("darkmode", false);
}

function loadSetting(setting, defaultValue) {
  let value = JSON.parse(window.localStorage.getItem(setting));
  if (value == null) {
    return defaultValue;
  }

  return value;
}

let isWebGLAvailable = function () {
  try {
    var canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
  } catch (e) {
    return false;
  }
};

function updateCalibration() {
  // Update the Calibration Container with the values from calibration
  const calMap = [
    { caption: "Uncalibrated", color: "#CC0000" },
    { caption: "Partially Calibrated", color: "#FF6600" },
    { caption: "Mostly Calibrated", color: "#FFCC00" },
    { caption: "Fully Calibrated", color: "#009900" },
  ];
  const calLabels = ["System", "Gyro", "Accelerometer", "Magnetometer"];

  calContainer.innerHTML = "";
  for (var i = 0; i < calibration.length; i++) {
    let calInfo = calMap[calibration[i]];
    let element = document.createElement("div");
    element.innerHTML = calLabels[i] + ": " + calInfo.caption;
    element.style = "color: " + calInfo.color;
    calContainer.appendChild(element);
  }
}

function saveSetting(setting, value) {
  window.localStorage.setItem(setting, JSON.stringify(value));
}

let bunny;

const renderer = new THREE.WebGLRenderer({ canvas });

const camera = new THREE.PerspectiveCamera(undefined, canvas.width / canvas.height, 0.1, 100);
camera.position.set(0, 0, 30);

const scene = new THREE.Scene();
scene.background = new THREE.Color("black");
{
  const skyColor = 0xb1e1ff; // light blue
  const groundColor = 0x666666; // black
  const intensity = 0.5;
  const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
  scene.add(light);
}

{
  const color = 0xffffff;
  const intensity = 1;
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(0, 10, 0);
  light.target.position.set(-5, 0, 0);
  scene.add(light);
  scene.add(light.target);
}

{
  const objLoader = new OBJLoader();
  errorLoadingModel = false;
  objLoader.load(
    "assets/bunny.obj",
    (root) => {
      bunny = root;
      root.add(new THREE.AxesHelper(30));
      root.position.set(0, -10, -25);
      scene.add(root);
    },
    () => {},
    () => {
      errorLoadingModel = true;
    }
  );
}

function onResize() {
  const canvas = renderer.domElement;

  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
}

async function render() {
  if (errorLoadingModel) return;

  if (bunny != null) {
    if (angleType.value == "euler") {
      let rotationEuler = new THREE.Euler(
        THREE.MathUtils.degToRad(orientation[2] - 180),
        THREE.MathUtils.degToRad(orientation[0] - 270),
        THREE.MathUtils.degToRad(orientation[1] - 180),
        "YZX"
      );
      bunny.setRotationFromEuler(rotationEuler);
    } else {
      let rotationQuaternion = new THREE.Quaternion(quaternion[1], quaternion[3], -quaternion[2], quaternion[0]);
      bunny.setRotationFromQuaternion(rotationQuaternion);
    }
  }

  renderer.render(scene, camera);
  updateCalibration();

  await sleep(10); // Allow 10ms for UI updates
  await finishDrawing();
  await render();
}
