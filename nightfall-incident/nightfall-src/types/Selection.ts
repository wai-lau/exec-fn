export enum SelectionType {
  UPLOAD_ZONE,
  PROGRAM,
  CREDIT,
  DATA_PACK,
}

export interface ISelection {
  type: SelectionType;
  id: string;
}
