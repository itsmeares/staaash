export const convertHeicToJpeg = async (inputBuffer: Buffer) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const heicConvert = require("heic-convert") as (options: {
    buffer: Buffer;
    format: "JPEG";
    quality: number;
  }) => Promise<ArrayBuffer>;

  return heicConvert({
    buffer: inputBuffer,
    format: "JPEG",
    quality: 0.92,
  });
};
