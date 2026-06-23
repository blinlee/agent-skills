export function parseQueryArgs(args) {
    const questionParts = [];
    let includeReview = false;
    let disableHyde = false;
    let full = false;
    let readingMode;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--include-review') {
            includeReview = true;
            continue;
        }
        if (arg === '--no-hyde') {
            disableHyde = true;
            continue;
        }
        if (arg === '--full') {
            full = true;
            continue;
        }
        if (arg === '--reading-mode') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('Missing value for flag: --reading-mode');
            }
            if (value !== 'passage' && value !== 'document') {
                throw new Error('Invalid value for --reading-mode: expected passage or document');
            }
            readingMode = value;
            index += 1;
            continue;
        }
        questionParts.push(arg);
    }
    return {
        question: questionParts.join(' ').trim(),
        includeReview,
        disableHyde,
        full,
        readingMode,
    };
}
export function parseCliFlags(args) {
    const flags = {};
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg?.startsWith('--')) {
            throw new Error(`Unexpected positional argument: ${arg}`);
        }
        const key = arg.slice(2);
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for flag: ${arg}`);
        }
        flags[key] = [...(flags[key] ?? []), value];
        index += 1;
    }
    return flags;
}
export function firstFlag(flags, key) {
    return flags[key]?.[0];
}
