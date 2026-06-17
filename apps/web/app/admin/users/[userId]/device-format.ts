export const formatSessionIp = (value: string | null) => {
  if (!value) return null;

  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }

  return value;
};
