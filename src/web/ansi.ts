const ANSI_CUBE_CHANNELS = [0, 95, 135, 175, 215, 255];
const ANSI_GRAY_CHANNELS = Array.from({ length: 24 }, (_, index) => 8 + index * 10);

function isByte(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 255;
}

function closestIndex(value: number, channels: number[]): number {
  let closest = 0;
  let distance = Infinity;
  for (let index = 0; index < channels.length; index++) {
    const candidateDistance = Math.abs(value - channels[index]!);
    if (candidateDistance < distance) {
      closest = index;
      distance = candidateDistance;
    }
  }
  return closest;
}

function rgbToAnsi256(red: number, green: number, blue: number): number {
  const redIndex = closestIndex(red, ANSI_CUBE_CHANNELS);
  const greenIndex = closestIndex(green, ANSI_CUBE_CHANNELS);
  const blueIndex = closestIndex(blue, ANSI_CUBE_CHANNELS);
  const cubeRed = ANSI_CUBE_CHANNELS[redIndex]!;
  const cubeGreen = ANSI_CUBE_CHANNELS[greenIndex]!;
  const cubeBlue = ANSI_CUBE_CHANNELS[blueIndex]!;
  const cubeDistance =
    (red - cubeRed) ** 2 * 0.299 +
    (green - cubeGreen) ** 2 * 0.587 +
    (blue - cubeBlue) ** 2 * 0.114;

  const gray = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
  const grayIndex = closestIndex(gray, ANSI_GRAY_CHANNELS);
  const grayValue = ANSI_GRAY_CHANNELS[grayIndex]!;
  const grayDistance =
    (red - grayValue) ** 2 * 0.299 +
    (green - grayValue) ** 2 * 0.587 +
    (blue - grayValue) ** 2 * 0.114;

  // Preserve hue unless the source color is effectively neutral.
  if (
    Math.max(red, green, blue) - Math.min(red, green, blue) < 10 &&
    grayDistance < cubeDistance
  ) {
    return 232 + grayIndex;
  }
  return 16 + 36 * redIndex + 6 * greenIndex + blueIndex;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) =>
    character === "&"
      ? "&amp;"
      : character === "<"
        ? "&lt;"
        : character === ">"
          ? "&gt;"
          : character === '"'
            ? "&quot;"
            : "&#39;",
  );
}

/** Render foreground ANSI SGR safely for extension status slots. */
export function renderAnsiToHtml(text: string): string {
  // OSC sequences are unrelated to text styling and must never reach the DOM.
  const sanitized = text.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
  const tokens = sanitized.split(/(\u001b\[[0-9;]*m)/);
  let output = "";
  let foreground: number | null = null;
  let bold = false;

  for (const token of tokens) {
    const match = /^\u001b\[([0-9;]*)m$/.exec(token);
    if (match) {
      const params = match[1] === "" ? [0] : match[1]!.split(";").map(Number);
      for (let index = 0; index < params.length; index++) {
        const param = params[index]!;
        if (param === 0) {
          foreground = null;
          bold = false;
        } else if (param === 1) {
          bold = true;
        } else if (param === 22) {
          bold = false;
        } else if (param === 39) {
          foreground = null;
        } else if (param >= 30 && param <= 37) {
          foreground = param - 30;
        } else if (param >= 90 && param <= 97) {
          foreground = 8 + param - 90;
        } else if (param === 38 && params[index + 1] === 5) {
          const paletteIndex = params[index + 2];
          if (isByte(paletteIndex)) foreground = paletteIndex;
          index += 2;
        } else if (param === 38 && params[index + 1] === 2) {
          const red = params[index + 2];
          const green = params[index + 3];
          const blue = params[index + 4];
          if (isByte(red) && isByte(green) && isByte(blue)) {
            foreground = rgbToAnsi256(red, green, blue);
          }
          // Consume RGB components even when malformed so they are not
          // misinterpreted as independent SGR commands.
          index += 4;
        }
      }
      continue;
    }

    const escaped = escapeHtml(token);
    if (foreground !== null || bold) {
      const classes = [
        ...(foreground !== null ? [`ansi-fg-${foreground}`] : []),
        ...(bold ? ["ansi-bold"] : []),
      ];
      output += `<span class="${classes.join(" ")}">${escaped}</span>`;
    } else {
      output += escaped;
    }
  }

  return output;
}

/** Strip terminal control sequences for plain-text tooltips. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
}
