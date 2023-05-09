// Utilities for signing and proving when working with messages as JS objects.

import { flatten, unflatten } from 'flat';
import { Encoder } from './encoder';
import { Statement, WitnessEqualityMetaStatement } from './composite-proof/statement';
import { BBSPlusBlindSignatureRequest, BBSPlusSignatureParamsG1 } from './bbs-plus';
import { BBSBlindSignatureRequest, BBSSignatureParams } from './bbs';
import { PSBlindSignatureRequest, PSSignatureParams } from './ps';
import { Witness } from './composite-proof/witness';

// The following `ts-ignore` shouldn't be necessary as per https://github.com/microsoft/TypeScript/pull/33050 but it still is (on TS 4.8)
// @ts-ignore
export type MessageStructure = Record<string, null | MessageStructure>;

export interface SignedMessages<Signature> {
  encodedMessages: { [key: string]: Uint8Array };
  signature: Signature;
}

export function flattenMessageStructure(msgStructure: MessageStructure): object {
  return flatten(msgStructure);
}

export interface IParams {
  label?: Uint8Array;

  supportedMessageCount(): number;
  adapt(messageCount: number): this;
}

export function getAdaptedSignatureParamsForMessages<Params extends IParams>(
  params: Params,
  msgStructure: MessageStructure
): Params {
  const flattened = flattenMessageStructure(msgStructure);
  return params.adapt(Object.keys(flattened).length);
}

/**
 * Given the messages as a JS object and the names (use "." for nested property names) of the messages to reveal, returns
 * the encoded messages to reveal and hide as separate maps with the key being the index of the message when the object is
 * flattened.
 * @param messages
 * @param revealedMsgNames
 * @param encoder
 */
export function getRevealedAndUnrevealed(
  messages: object,
  revealedMsgNames: Set<string>,
  encoder: Encoder
): [Map<number, Uint8Array>, Map<number, Uint8Array>, object] {
  const [names, encodedValues] = encoder.encodeMessageObject(messages);
  const revealedMsgs = new Map<number, Uint8Array>();
  const unrevealedMsgs = new Map<number, Uint8Array>();
  let found = 0;
  for (let i = 0; i < names.length; i++) {
    if (revealedMsgNames.has(names[i])) {
      revealedMsgs.set(i, encodedValues[i]);
      found++;
    } else {
      unrevealedMsgs.set(i, encodedValues[i]);
    }
  }

  if (revealedMsgNames.size !== found) {
    throw new Error(
      `Some of the revealed message names were not found in the given messages object, ${
        revealedMsgNames.size - found
      } extra names found`
    );
  }

  // This will be given to the verifier to encode independently.
  const revealedMsgsRaw: { [key: string]: unknown } = {};
  const flattened = flatten(messages);
  // @ts-ignore
  revealedMsgNames.forEach((n: string) => (revealedMsgsRaw[n] = flattened[n]));
  return [revealedMsgs, unrevealedMsgs, unflatten(revealedMsgsRaw)];
}

/**
 * Used by the verifier to encode the revealed messages given by the prover.
 * @param revealedMsgsRaw - Revealed messages given by the prover.
 * @param msgStructure - Message structure, i.e. the structure of JS object with key names but values redacted.
 * @param encoder
 */
export function encodeRevealedMsgs(
  revealedMsgsRaw: object,
  msgStructure: MessageStructure,
  encoder: Encoder
): Map<number, Uint8Array> {
  const revealed = new Map<number, Uint8Array>();
  const names = Object.keys(flattenMessageStructure(msgStructure)).sort();
  const flattenedRevealed = flatten(revealedMsgsRaw) as object;
  Object.entries(flattenedRevealed).forEach(([n, v]) => {
    const i = names.indexOf(n);
    if (i === -1) {
      throw new Error(`Message name ${n} was not found`);
    }
    revealed.set(i, encoder.encodeMessage(n, v));
  });
  return revealed;
}

/**
 * Check if the given structure is compatible with the given messages object.
 * @param messages
 * @param msgStructure
 */
export function isValidMsgStructure(messages: object, msgStructure: MessageStructure): boolean {
  const namesInStruct = Object.keys(flattenMessageStructure(msgStructure)).sort();
  const namesInMsgs = Object.keys(flatten(messages) as object).sort();
  return (
    namesInMsgs.length === namesInStruct.length &&
    (() => {
      for (let i = 0; i <= namesInMsgs.length; i++) {
        if (namesInStruct[i] !== namesInMsgs[i]) {
          return false;
        }
      }
      return true;
    })()
  );
}

/**
 * Flattens the object `msgStructure` and returns the indices of names given in `msgNames`
 * @param msgNames
 * @param msgStructure
 * @returns Returns in same order as given names in `msgNames`
 */
export function getIndicesForMsgNames(msgNames: string[], msgStructure: MessageStructure): number[] {
  const allNames = Object.keys(flattenMessageStructure(msgStructure)).sort();
  return msgNames.map((n) => {
    const i = allNames.indexOf(n);
    if (i === -1) {
      throw new Error(`Message name ${n} was not found`);
    }
    return i;
  });
}

/**
 * Takes an equality of messages across statements and returns the `MetaStatement` to be used in the proof.
 * @param equality - Map with key as the statement index and value as the message names of that statement
 * that are to be proved equal and the message structure.
 */
export function createWitnessEqualityMetaStatement(
  equality: Map<number, [msgNames: string[], msgStructure: MessageStructure]>
): WitnessEqualityMetaStatement {
  const ms = new WitnessEqualityMetaStatement();
  for (const [sIdx, [names, struct]] of equality.entries()) {
    const indices = getIndicesForMsgNames(names, struct);
    indices.forEach((i) => ms.addWitnessRef(sIdx, i));
  }
  return ms;
}

/**
 * Get the statement to be used in composite proof for the blind signature request
 * @param request
 * @param sigParams
 */
export function getBBSStatementForBlindSigRequest(
  request: BBSBlindSignatureRequest,
  sigParams: BBSSignatureParams
): Uint8Array {
  const commKey = sigParams.getParamsForIndices(request.blindedIndices);
  return Statement.pedersenCommitmentG1(commKey, request.commitment);
}

/**
 * Get the statement to be used in composite proof for the blind signature request
 * @param request
 * @param sigParams
 */
export function getBBSWitnessForBlindSigRequest(messages: Map<number, Uint8Array>): Uint8Array {
  const sortedMessages = [...messages.entries()];
  sortedMessages.sort(([a], [b]) => a - b);

  return Witness.pedersenCommitment(sortedMessages.map(([_, m]) => m));
}

/**
 * Get the statement to be used in composite proof for the blind signature request
 * @param request
 * @param sigParams
 */
export function getBBSPlusStatementForBlindSigRequest(
  request: BBSPlusBlindSignatureRequest,
  sigParams: BBSPlusSignatureParamsG1
): Uint8Array {
  const commKey = sigParams.getParamsForIndices(request.blindedIndices);
  return Statement.pedersenCommitmentG1(commKey, request.commitment);
}

/**
 * Get the statement to be used in composite proof for the blind signature request
 * @param request
 * @param sigParams
 */
export function getBBSPlusWitnessForBlindSigRequest(
  messages: Map<number, Uint8Array>,
  blinding: Uint8Array
): Uint8Array {
  const sortedMessages = [...messages.entries()];
  sortedMessages.sort(([a], [b]) => a - b);

  return Witness.pedersenCommitment([blinding, ...sortedMessages.map(([_, m]) => m)]);
}

/**
 * Get the statement to be used in composite proof for the blind signature request
 * @param request
 * @param sigParams
 */
export function getPSStatementsForBlindSigRequest(
  request: PSBlindSignatureRequest,
  sigParams: PSSignatureParams,
  h: Uint8Array
): Uint8Array[] {
  const sortedCommitments = [...request.commitments.entries()].sort(([a], [b]) => a - b);
  const hArr = sigParams.getParamsForIndices(sortedCommitments.map(([key]) => key));

  return [
    Statement.pedersenCommitmentG1([sigParams.value.g, ...hArr], request.commitment),
    ...sortedCommitments.map(([_, commitment]) => Statement.pedersenCommitmentG1([sigParams.value.g, h], commitment))
  ];
}

/**
 * Get the statement to be used in composite proof for the blind signature request
 * @param request
 * @param sigParams
 */
export function getPSWitnessesForBlindSigRequest(
  messages: Map<number, Uint8Array>,
  blinding: Uint8Array,
  blindings: Map<number, Uint8Array>
): Uint8Array[] {
  const sortedMessages = [...messages.entries()].sort(([a], [b]) => a - b);

  return [
    Witness.pedersenCommitment([blinding, ...sortedMessages.map(([_, msg]) => msg)]),
    ...sortedMessages.map(([idx, msg]) => {
      const blinding = blindings.get(idx);
      if (blinding == null) throw new Error(`Missing blinding for ${idx}`);

      return Witness.pedersenCommitment([blinding, msg]);
    })
  ];
}
