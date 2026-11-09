declare module "midi" {
  class Output {
    getPortCount(): number;
    getPortName(port: number): string;
    openPort(port: number): void;
    closePort(): void;
    sendMessage(message: number[]): void;
  }
  class Input {
    getPortCount(): number;
    getPortName(port: number): string;
    openPort(port: number): void;
    closePort(): void;
    ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
    on(event: "message", cb: (deltaTime: number, message: number[]) => void): void;
  }
  const midi: { Output: typeof Output; Input: typeof Input };
  export = midi;
}
