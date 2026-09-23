export interface IBaseSchemaField {
  required?: boolean;
  index?: boolean;
  unique?: boolean;
  sparse?: boolean;
}

export interface IStringSchemaField extends IBaseSchemaField {
  type: StringConstructor;
  trim?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  default?: string;
  enum?: readonly string[];
}

export interface INumberSchemaField extends IBaseSchemaField {
  type: NumberConstructor;
  default?: number;
  min?: number;
  max?: number;
}

export interface IBooleanSchemaField extends IBaseSchemaField {
  type: BooleanConstructor;
  default?: boolean;
}

export interface IDateSchemaField extends IBaseSchemaField {
  type: DateConstructor;
  default?: Date | (() => Date);
}


export interface ISchemaFieldConfig {
  type: unknown;
  required?: boolean;
  unique?: boolean;
  sparse?: boolean;
  index?: boolean;
  trim?: boolean;
  lowercase?: boolean;
  default?: unknown;
  enum?: readonly unknown[];
  ref?: string;
}