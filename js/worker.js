let port;
let reader;
let inputDone;
let outputDone;
let inputStream;
let outputStream;
let showCalibration = false;

let orientation = [0, 0, 0];
let quaternion = [1, 0, 0, 0];
let calibration = [0, 0, 0, 0];

addEventListener("message", async (evt) => {
  const { type, ...body } = evt.data;

  switch (evt.data.type) {
    case "CONNECT":
      connect(body.baudRate);
      break;
    case "DISCONNECT":
      disconnect();
      break;
  }
});

/**
 * @name connect
 * Opens a Web Serial connection to a micro:bit and sets up the input and
 * output stream.
 */
async function connect(baudRate) {
  [port] = await navigator.serial.getPorts();
  await port.open({ baudRate });

  let decoder = new TextDecoderStream();
  inputDone = port.readable.pipeTo(decoder.writable);
  inputStream = decoder.readable.pipeThrough(
    new TransformStream(new LineBreakTransformer())
  );

  reader = inputStream.getReader();
  readLoop().catch(disconnect);
  self.postMessage({ type: "CONNECTED" });
}

/**
 * @name disconnect
 * Closes the Web Serial connection.
 */
async function disconnect() {
  if (reader) {
    await reader.cancel();
    await inputDone.catch(() => {});
    reader = null;
    inputDone = null;
  }

  if (outputStream) {
    await outputStream.getWriter().close();
    await outputDone;
    outputStream = null;
    outputDone = null;
  }

  await port.close();
}

/**
 * @name readLoop
 * Reads data from the input stream and displays it on screen.
 */
async function readLoop() {
  while (true) {
    const { value, done } = await reader.read();

    if (value) {
      if (value.startsWith("Orientation:")) {
        orientation = value
          .substr(12)
          .trim()
          .split(",")
          .map((x) => +x);
      } else if (value.startsWith("Quaternion:")) {
        quaternion = value
          .substr(11)
          .trim()
          .split(",")
          .map((x) => +x);
      } else if (value.startsWith("Calibration:")) {
        calibration = value
          .substr(12)
          .trim()
          .split(",")
          .map((x) => +x);

        if (!showCalibration) {
          showCalibration = true;
          self.postMessage({ type: "SHOW_CALIBRATION" });
        }
      }

      self.postMessage({
        type: "DATA_READ",
        orientation,
        quaternion,
        calibration,
      });
    }

    if (done) {
      console.log("[readLoop] DONE", done);
      reader.releaseLock();
      break;
    }
  }
}

/**
 * @name LineBreakTransformer
 * TransformStream to parse the stream into lines.
 */
class LineBreakTransformer {
  constructor() {
    // A container for holding stream data until a new line.
    this.container = "";
  }

  transform(chunk, controller) {
    this.container += chunk;
    const lines = this.container.split("\n");
    this.container = lines.pop();
    lines.forEach((line) => {
      controller.enqueue(line);
      // self.postMessage({ type: "LOG_DATA", line });
    });
  }

  flush(controller) {
    controller.enqueue(this.container);
  }
}
