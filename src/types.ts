export interface ColumnColors {
	[value: string]: string;
}

export interface ColorConfig {
	version: 1;
	columns: {
		[columnName: string]: ColumnColors;
	};
}

export const DEFAULT_COLOR_CONFIG: ColorConfig = {
	version: 1,
	columns: {}
};

// Global (per-vault) appearance settings, stored in the plugin's data.json —
// not in .colors.json, which stays per-base color data only.
export interface PillShapeSettings {
	customShape: boolean;
	paddingX: number;
	paddingY: number;
	borderRadius: number;
}

// Defaults mirror the original Notion-style design snippet the plugin was
// built alongside: text never touches the corners, mid-hard 4px radius.
export const DEFAULT_PILL_SHAPE: PillShapeSettings = {
	customShape: true,
	paddingX: 6,
	paddingY: 2,
	borderRadius: 4,
};
