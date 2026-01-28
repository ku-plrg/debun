import { POGHash } from '../types/types';
import extractFunctions from './function-collector';
import poghash from './hash-function';
import pog from './pog-generator';

function fingerprintCollector(raw: string): POGHash[] {
  const functions = extractFunctions(raw);
  const pogs = pog(functions);
  const hash = poghash(pogs);
  return hash;
}

export default fingerprintCollector;
