// Catppuccin Mocha color palette for resource types
export const resourceColors = {
	note: {
		color: '#a6e3a1', // Green
		bgAlpha: 'rgba(166, 227, 161, 0.2)',
	},
	folder: {
		color: '#f9e2af', // Yellow
		bgAlpha: 'rgba(249, 226, 175, 0.2)',
	},
	vault: {
		color: '#c084fc', // Purple
		bgAlpha: 'rgba(192, 132, 252, 0.2)',
	},
	action: {
		color: 'var(--color-accent)',
		bgAlpha: 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
	},
} as const;

export type ResourceType = keyof typeof resourceColors;

export function getResourceColor(type: ResourceType) {
	return resourceColors[type];
}
