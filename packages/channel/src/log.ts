/** Logs a stderr (stdout es del protocolo MCP). La key nunca sale: se tapa con `***`, como en el CLI. */
export type Log = (msg: string) => void;

export function makeLog(key: string | null, write: (s: string) => void = (s) => process.stderr.write(s)): Log {
  return (msg) => {
    const line = `dagyard-channel: ${msg}\n`;
    write(key ? line.split(key).join('***') : line);
  };
}
