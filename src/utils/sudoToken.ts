import { jwtVerify, importSPKI } from 'jose';
import { config } from '../config/index.js';

// Mirror of user-service's sudo token shape. trip-service only VERIFIES (it has
// the public key, never the private key — those tokens are minted by user-service).
export type SudoAction = 'change_password' | 'delete_account' | 'purchase_ticket';

export interface SudoTokenPayload {
  sub: string;
  type: 'sudo';
  action: SudoAction;
  jti: string;
  iat: number;
  exp: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _publicKey: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getPublicKey = async (): Promise<any> => {
  if (!_publicKey) _publicKey = await importSPKI(config.jwt.publicKey, 'EdDSA');
  return _publicKey;
};

export const verifySudoToken = async (token: string): Promise<SudoTokenPayload> => {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, { algorithms: ['EdDSA'] });
  return payload as unknown as SudoTokenPayload;
};
