import type { ConversationScript, HaleTaunts, IntelDoc } from './types';
import legionary from './legionary.json';
import trooper from './trooper.json';
import lucca from './lucca.json';
import lucretia from './lucretia.json';
import hale from './hale.json';
import intel from './intel.json';

/** All scripted conversation content, typed. JSON stays the source of truth. */
export const content = {
  legionary: legionary as ConversationScript[],
  trooper: trooper as ConversationScript[],
  lucca: lucca as ConversationScript[],
  lucretia: lucretia as ConversationScript[],
  hale: hale as HaleTaunts,
  intel: intel as IntelDoc[],
};

export type DialogueContent = typeof content;
