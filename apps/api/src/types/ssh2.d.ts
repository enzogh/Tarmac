declare module 'ssh2' {
  export type ConnectConfig = {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    readyTimeout?: number;
    tryKeyboard?: boolean;
  };

  export type ParsedKey = {
    type: string;
    comment: string;
    isPrivateKey(): boolean;
  };

  export const utils: {
    parseKey(data: string | Buffer, passphrase?: string | Buffer): ParsedKey | ParsedKey[] | Error;
  };

  export class Client {
    on(event: 'ready', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    connect(config: ConnectConfig): this;
    exec(
      command: string,
      callback: (
        error: Error | undefined,
        stream: {
          on(event: 'close', listener: (code?: number) => void): any;
          on(event: 'data', listener: (data: Buffer) => void): any;
          stderr: {
            on(event: 'data', listener: (data: Buffer) => void): any;
          };
        },
      ) => void,
    ): void;
    end(): void;
  }
}
