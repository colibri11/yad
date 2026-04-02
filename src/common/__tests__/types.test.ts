import { describe, expect, it } from "vitest";
import {
  isLikelyText,
  jsonResult,
  requirePassword,
  resolveLogin,
  textResult,
  type YandexPluginConfig,
} from "../types.js";

describe("resolveLogin", () => {
  it("returns full email as-is", () => {
    expect(resolveLogin("user@yandex.ru")).toBe("user@yandex.ru");
  });

  it("returns custom domain email as-is", () => {
    expect(resolveLogin("user@example.com")).toBe("user@example.com");
  });

  it("appends @yandex.ru to bare login", () => {
    expect(resolveLogin("user")).toBe("user@yandex.ru");
  });

  it("appends @yandex.ru to login with dots", () => {
    expect(resolveLogin("ivan.petrov")).toBe("ivan.petrov@yandex.ru");
  });
});

describe("requirePassword", () => {
  const baseConfig: YandexPluginConfig = { login: "user" };

  it("returns password when configured", () => {
    const config = { ...baseConfig, disk_app_password: "secret123" };
    expect(requirePassword(config, "disk")).toBe("secret123");
  });

  it("throws when password is missing", () => {
    expect(() => requirePassword(baseConfig, "mail")).toThrow(
      /App password for mail is not configured/,
    );
  });

  it("throws when password is empty string", () => {
    const config = { ...baseConfig, mail_app_password: "" };
    expect(() => requirePassword(config, "mail")).toThrow(
      /App password for mail is not configured/,
    );
  });

  it("includes correct type name in error message", () => {
    expect(() => requirePassword(baseConfig, "disk")).toThrow('"Файлы"');
    expect(() => requirePassword(baseConfig, "mail")).toThrow('"Почта"');
    expect(() => requirePassword(baseConfig, "calendar")).toThrow('"Календари"');
    expect(() => requirePassword(baseConfig, "contacts")).toThrow('"Контакты"');
  });

  it("includes config key name in error message", () => {
    expect(() => requirePassword(baseConfig, "disk")).toThrow('"disk_app_password"');
  });
});

describe("textResult", () => {
  it("wraps text in OpenClaw content format", () => {
    const result = textResult("hello");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("handles empty string", () => {
    const result = textResult("");
    expect(result.content[0].text).toBe("");
  });
});

describe("jsonResult", () => {
  it("serializes object to pretty JSON", () => {
    const result = jsonResult({ a: 1, b: "two" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ a: 1, b: "two" });
  });

  it("uses 2-space indentation", () => {
    const result = jsonResult({ key: "value" });
    expect(result.content[0].text).toContain("  ");
  });

  it("handles arrays", () => {
    const result = jsonResult([1, 2, 3]);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    const result = jsonResult(null);
    expect(result.content[0].text).toBe("null");
  });
});

describe("isLikelyText", () => {
  it("returns true for UTF-8 text", () => {
    expect(isLikelyText(Buffer.from("Hello, world!"))).toBe(true);
  });

  it("returns true for Russian text", () => {
    expect(isLikelyText(Buffer.from("Привет, мир!"))).toBe(true);
  });

  it("returns true for empty buffer", () => {
    expect(isLikelyText(Buffer.alloc(0))).toBe(true);
  });

  it("returns false for buffer with null bytes", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]);
    expect(isLikelyText(buf)).toBe(false);
  });

  it("returns false for binary content (PNG header)", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(isLikelyText(png)).toBe(false);
  });
});
