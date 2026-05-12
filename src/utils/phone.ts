export type MobileNetwork = 'mtn' | 'airtel';

const MTN_PREFIXES = ['070', '078', '079'];
const AIRTEL_PREFIXES = ['072', '073', '074'];

export const detectNetwork = (phone: string): MobileNetwork | null => {
  const digits = phone.replace(/^\+250/, '0').replace(/\s/g, '');
  const prefix = digits.slice(0, 3);
  if (MTN_PREFIXES.includes(prefix)) return 'mtn';
  if (AIRTEL_PREFIXES.includes(prefix)) return 'airtel';
  return null;
};
