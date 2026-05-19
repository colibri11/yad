export function resolveLogin(login) {
    if (login.includes("@"))
        return login;
    return `${login}@yandex.ru`;
}
export function requirePassword(config, service) {
    const key = `${service}_app_password`;
    const password = config[key];
    if (!password || typeof password !== "string") {
        const typeNames = {
            mail: "Почта",
            calendar: "Календари",
            disk: "Файлы",
            contacts: "Контакты",
        };
        throw new Error(`App password for ${service} is not configured. ` +
            `Create one at https://id.yandex.ru/security/app-passwords (type: "${typeNames[service]}") ` +
            `and set it in the plugin config as "${key}".`);
    }
    return password;
}
export function textResult(text) {
    return { content: [{ type: "text", text }] };
}
export function jsonResult(data) {
    return textResult(JSON.stringify(data, null, 2));
}
export function isLikelyText(buf) {
    const sample = buf.subarray(0, Math.min(buf.length, 8192));
    let nullCount = 0;
    for (const byte of sample) {
        if (byte === 0)
            nullCount++;
    }
    return nullCount === 0;
}
//# sourceMappingURL=types.js.map