export function isEnvEmpty(env: string | null | undefined): boolean {
	if (typeof env === 'string') {
		return env.trim() === '';
	}
	return true;
}

export function isNone(data: unknown): data is null | undefined {
	return data === null || typeof data === 'undefined';
}

export function getFirstOne(arr: string | string[] | undefined): string | null {
	if (Array.isArray(arr)) {
		return arr[0] ?? null;
	}
	if (typeof arr === 'string') {
		return arr;
	}
	return null;
}

export function walkJson(
	dataset: Record<string, unknown>,
	paths: string,
): Record<string, unknown> | null {
	let obj = dataset;
    const allPaths = paths.split(".")
    for (let i = 0; i < allPaths.length; i++) {
        if (isNone(dataset)) {
            return null;
        }
        const p = allPaths[i];
        if (!Number.isNaN(Number.parseInt(p, 10))) {
			// @ts-expect-error
            obj = obj[Number.parseInt(p, 10)]
        } else {
			// @ts-expect-error
            obj = obj[p]
        }
    }
    return obj;
}

function omitKeysInsensitive<T extends Record<string, unknown>>(
	obj: T,
	keys: (keyof T)[],
): Omit<T, keyof T> {
	// Create a new object without the specified keys
	const newObj: Partial<T> = { ...obj };
	for (const key of keys) {
		const lowerKey = key.toString().toLowerCase();
		for (const objKey in newObj) {
			if (objKey.toLowerCase() === lowerKey) {
				delete newObj[objKey];
			}
		}
	}
	return newObj as Omit<T, keyof T>;
}

export function JSONResponse(
	data: unknown,
	status: number = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=UTF-8',
			...omitKeysInsensitive(headers, ['Content-Type']),
		},
	});
}

export function TextResponse(
	data: string,
	status: number = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(data, {
		status,
		headers: {
			'Content-Type': 'text/plain; charset=UTF-8',
			...omitKeysInsensitive(headers, ['Content-Type']),
		},
	});
}
