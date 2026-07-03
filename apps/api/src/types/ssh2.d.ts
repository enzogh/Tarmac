declare module 'ssh2' {
  export type ConnectConfig = {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    readyTimeout?: number;
    tryKeyboard?: boolean;
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
