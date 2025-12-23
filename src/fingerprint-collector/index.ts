import { POGHash } from '../types/pog';
import extractFunctions from './function-collector';
import poghash from './hash-function';
import pog from './pog-generator';

function fingerprintCollector(
  raw: string,
  options: [boolean, boolean, boolean] = [true, true, true]
): POGHash[] {
  const functions = extractFunctions(raw);
  const pogs = pog(functions, options);
  const hash = poghash(pogs);
  return hash;
}

export default fingerprintCollector;
