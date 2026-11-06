import { launch } from '@cloudflare/playwright';
import userCardTemplate from './user_card_template.html';

const MAX_AVATAR_BYTES = 900_000;
const MAX_FIELD_LENGTH = 256;
const READY_TIMEOUT_MS = 30_000;
const ALLOWED_STATUS_IDS = new Set(['online', 'idle', 'dnd', 'off']);
const ALLOWED_AVATAR_DOMAINS = ['discordapp.com', 'discordapp.net'];
const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/]+={0,2}$/i;

type JsonObject = Record<string, unknown>;
type RenderPageGlobal = {
	document: {
		body: { clientHeight: number };
		getElementById(id: string): { textContent: string | null } | null;
	};
	seleniumCallChange?: (serializedData: string) => void;
};

export type UserCardData = {
	u?: string;
	un?: string;
	created?: string;
	joined?: string;
	highRole: {
		hName?: string;
		hCol?: string;
	};
	status: {
		sText?: string;
		sId?: string;
	};
	avatar?: string;
	flags: string[];
};

export class UserCardInputError extends Error {}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getObjectField(record: JsonObject, field: string): JsonObject {
	const value = record[field];
	if (value === undefined || value === null) {
		return {};
	}
	if (!isJsonObject(value)) {
		throw new UserCardInputError(`\`${field}\` must be an object.`);
	}
	return value;
}

function getOptionalText(record: JsonObject, field: string, maxLength = MAX_FIELD_LENGTH): string | undefined {
	const value = record[field];
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value !== 'string' && typeof value !== 'number') {
		throw new UserCardInputError(`\`${field}\` must be a string or number.`);
	}

	const text = String(value);
	if (text.length > maxLength) {
		throw new UserCardInputError(`\`${field}\` must be ${maxLength} characters or fewer.`);
	}
	return text;
}

function getAvatar(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new UserCardInputError('`avatar` must be an HTTPS URL or a base64 image data URL.');
	}
	if (value.length > MAX_AVATAR_BYTES) {
		throw new UserCardInputError('`avatar` is too large.');
	}

	if (DATA_IMAGE_PATTERN.test(value)) {
		return value;
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new UserCardInputError('`avatar` must be an HTTPS URL or a base64 image data URL.');
	}

	const hostname = url.hostname.toLowerCase();
	const isDiscordImageHost = ALLOWED_AVATAR_DOMAINS.some(
		(domain) => hostname === domain || hostname.endsWith(`.${domain}`)
	);
	if (url.protocol !== 'https:' || url.username || url.password || !isDiscordImageHost) {
		throw new UserCardInputError('`avatar` URLs must use HTTPS and a Discord image host.');
	}
	return url.toString();
}

export function parseUserCardData(value: unknown): UserCardData {
	if (!isJsonObject(value)) {
		throw new UserCardInputError('The JSON body must be an object.');
	}

	const highRole = getObjectField(value, 'highRole');
	const status = getObjectField(value, 'status');
	const requestedStatusId = getOptionalText(status, 'sId', 16);
	const statusId = requestedStatusId === 'offline' ? 'off' : requestedStatusId;
	if (statusId !== undefined && !ALLOWED_STATUS_IDS.has(statusId)) {
		throw new UserCardInputError('`status.sId` must be online, idle, dnd, or off.');
	}

	const rawFlags = value.flags;
	if (rawFlags !== undefined && rawFlags !== null && !Array.isArray(rawFlags)) {
		throw new UserCardInputError('`flags` must be an array of strings.');
	}
	const flags = (rawFlags ?? []) as unknown[];
	if (flags.length > 32 || flags.some((flag) => typeof flag !== 'string' || flag.length > 64)) {
		throw new UserCardInputError('`flags` must contain at most 32 strings of 64 characters or fewer.');
	}

	return {
		u: getOptionalText(value, 'u', 128),
		un: getOptionalText(value, 'un', 128),
		created: getOptionalText(value, 'created'),
		joined: getOptionalText(value, 'joined'),
		highRole: {
			hName: getOptionalText(highRole, 'hName', 128),
			hCol: getOptionalText(highRole, 'hCol', 64),
		},
		status: {
			sText: getOptionalText(status, 'sText', 128),
			sId: statusId,
		},
		avatar: getAvatar(value.avatar),
		flags: flags as string[],
	};
}

export async function renderUserCard(data: UserCardData, browser: BrowserRun): Promise<Response> {
	const browserSession = await launch(browser);
	try {
		const page = await browserSession.newPage({ viewport: { width: 800, height: 600 } });
		await page.setContent(userCardTemplate, { waitUntil: 'networkidle', timeout: READY_TIMEOUT_MS });
		await page.waitForTimeout(500);

		await page.evaluate((serializedData) => {
			const pageGlobal = globalThis as unknown as RenderPageGlobal;
			if (typeof pageGlobal.seleniumCallChange !== 'function') {
				throw new Error('The user card template is missing its render function.');
			}
			pageGlobal.seleniumCallChange(serializedData);
		}, JSON.stringify(data));

		await page.waitForFunction(
			() => {
				const pageGlobal = globalThis as unknown as RenderPageGlobal;
				return pageGlobal.document.getElementById('ready-notifier')?.textContent === 'ready';
			},
			undefined,
			{ timeout: READY_TIMEOUT_MS }
		);

		const bodyHeight = await page.evaluate(() => {
			return (globalThis as unknown as RenderPageGlobal).document.body.clientHeight;
		});
		const screenshotHeight = bodyHeight + 40;
		await page.setViewportSize({ width: 800, height: screenshotHeight });

		const image = await page.screenshot({
			type: 'png',
			clip: { x: 0, y: 0, width: 510, height: screenshotHeight },
		});
		return new Response(image, {
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'no-store',
			},
		});
	} finally {
		await browserSession.close();
	}
}
