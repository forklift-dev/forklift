export interface AvailableRelease {
  version: string;
  url: string;
}

export type ReleaseCheck =
  | { status: 'available'; release: AvailableRelease }
  | { status: 'current' }
  | { status: 'unsupported' };
