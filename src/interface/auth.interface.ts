export type UserRole = 'owner' | 'admin';

export interface ITokenPayload {
  sub: string;
  businessId?: string;
  accountId?: string | number;
  role?: UserRole;
}

export interface IRequestAuth {
  userId: string;
  businessId?: string;
  accountId: string | number;
  role: UserRole;
}
