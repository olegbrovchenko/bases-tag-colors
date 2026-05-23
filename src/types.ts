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
