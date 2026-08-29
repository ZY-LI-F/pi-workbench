import { parseCompanionPairingUri } from "../../../src/shared/companion-protocol";

export interface CompanionPairingCodeReader {
  scanQrCode(): Promise<string>;
}

function scannerErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

function scannerErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Validates scanner output while keeping native-camera details outside App and Host Fleet. */
export class CompanionPairingScanner {
  readonly #reader: CompanionPairingCodeReader;

  constructor(reader: CompanionPairingCodeReader) {
    this.#reader = reader;
  }

  async scan(): Promise<string | undefined> {
    let raw: string;
    try {
      raw = (await this.#reader.scanQrCode()).trim();
    } catch (cause) {
      const code = scannerErrorCode(cause);
      const message = scannerErrorMessage(cause);
      if (code === "OS-PLUG-BARC-0006" || /process was cancelled|scanning cancelled/i.test(message)) return undefined;
      if (code === "OS-PLUG-BARC-0007" || /camera access|camera permission|permission denied/i.test(message)) {
        throw new Error("无法使用相机。请在 Android 系统设置中允许 Stella Companion 使用相机后重试。");
      }
      throw new Error(`扫码器启动失败：${message}`);
    }

    if (!raw) throw new Error("二维码已读取，但没有可用内容，请重新扫描。");
    try {
      parseCompanionPairingUri(raw);
    } catch (cause) {
      throw new Error(`二维码已读取，但不是有效的 Stella Companion 配对码：${scannerErrorMessage(cause)}`);
    }
    return raw;
  }
}

const capacitorPairingCodeReader: CompanionPairingCodeReader = Object.freeze({
  async scanQrCode() {
    const {
      CapacitorBarcodeScanner,
      CapacitorBarcodeScannerAndroidScanningLibrary,
      CapacitorBarcodeScannerCameraDirection,
      CapacitorBarcodeScannerScanOrientation,
      CapacitorBarcodeScannerTypeHint,
    } = await import("@capacitor/barcode-scanner");
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: "扫描桌面 Stella 显示的 Companion 配对码",
      scanButton: false,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      cancelButtonAccessibilityLabel: "取消扫码",
      torchButtonOnAccessibilityLabel: "关闭闪光灯",
      torchButtonOffAccessibilityLabel: "打开闪光灯",
      android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.MLKIT },
    });
    return result.ScanResult;
  },
});

export const companionPairingScanner = new CompanionPairingScanner(capacitorPairingCodeReader);
