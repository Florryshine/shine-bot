// lib/ai/classify.js — Responsibility 3: message classification into
// GREEN (AI handles) / ORANGE (Florry handles) / RED (urgent safety).
//
// Two layers, so obvious cases don't wait on an LLM round-trip and nuanced
// cases get real understanding:
//   1. fastPath() — conservative deterministic checks: explicit human request
//      and explicit crisis language. Deliberately narrow to avoid the classic
//      false positives of keyword routing (Nigerian exam hyperbole).
//   2. LLM structured classification (json_schema on gpt-oss) for everything
//      else, biased towards human review when uncertain.

import appConfig from '../config.js';
import { callAIStructured, callAI } from './client.js';
import { CLASSIFICATION_SCHEMA, classificationPrompt } from './prompts.js';

// Explicit request for the human mentor — Phase 3 rule: "Allow a student to
// request human attention explicitly."
const HUMAN_REQUEST_RE = /\b(florry|florryshine|coach|madam|ma['’]?am|human|real person|real human|admin|mentor)\b/i;
const HUMAN_INTENT_RE = /\b(talk|speak|chat|discuss|connect|speak)\s+(to|with)\b|\b(can i (talk|speak)|i need to talk|i want to talk|talk to someone|talk to (a|the) (human|person|coach|admin)|see florry|call me|reach out to me)\b/i;

// Explicit crisis language — narrow on purpose. Hyperbole that contains these
// words ("kill this exam") is still routed to the LLM classifier, which judges
// intent with context. Only direct first-person danger phrasing short-circuits.
const CRISIS_RE = new RegExp(
  [
    /\b(?:i(?:'m| am)?|am|feeling|feel)\s+(?:so\s+|really\s+|very\s+)?(?:going to|gonna|about to|want(?:ing)? to|plan(?:ning)? to|try(?:ing)? to)\s+(?:kill|harm|hurt|end)\s+(?:myself|my life)\b/i,
    /\b(?:kill|harm|hurt)\s+myself\b/i,
    /\bend\s+(?:my|it)\s+all\b/i,
    /\bsuicid\w*\b/i,
    /\b(?:don'?t|do not|no)\s+want\s+to\s+(?:live|be alive|exist)\b/i,
    // "want to die" — unambiguous on its own, but exam-result hyperbole
    // ("want to die seeing this result") is judged by the LLM instead.
    /\bwant(?:s)?\s+to\s+die\b(?!(?:\s+\w+){0,2}\s+(?:exam|exams|result|results|test|tests|score|scores|maths?|questions?|paper|papers|jamb|waec|post[-\s]?utme|grade|grades))/i,
    /\bself[-\s]?harm\w*\b/i,
    /\bcut(?:ting)?\s+myself\b/i,
    /\b(?:being|been)\s+(?:beaten|raped|molested|abused)\b/i,
    /\b(?:beat|beats|beating|raped|raping|molesting|molested)\s+me\b/i,
    /\b(?:heavy|severe)\s+bleeding\b|\bbleeding\s+(?:heavily|badly|non[-\s]?stop)\b/i,
    /\bcan(?:'t|not)\s+breathe\b/i,
    /\bchest\s+pain\b.*\b(?:can'?t|cannot)\b/i,
    /\b(?:overdose|took\s+(?:too\s+many|all)\s+(?:pills|drugs))\b/i,
  ].map((r) => r.source).join('|'),
  'i'
);

export function fastPath(text) {
  const t = String(text || '');
  if (CRISIS_RE.test(t)) {
    return { category: 'red', topic: 'crisis_safety', is_academic: false, reason: 'explicit safety-crisis language', source: 'fastpath' };
  }
  if (HUMAN_REQUEST_RE.test(t) && HUMAN_INTENT_RE.test(t)) {
    return { category: 'orange', topic: 'human_requested', is_academic: false, reason: 'student explicitly asked for a human/Florry', source: 'fastpath' };
  }
  if (/\b(?:i\s+want|please|can)\s+(?:i\s+)?(?:talk|speak)\s+to\s+(?:florry|florryshine)\b/i.test(t)
    || /\bflorry\b/i.test(t) && /\b(?:only|directly|personally)\b/i.test(t)) {
    return { category: 'orange', topic: 'human_requested', is_academic: false, reason: 'student explicitly asked for Florry', source: 'fastpath' };
  }
  return null;
}

export async function classifyMessage({ student, messageText, recentContext = '', overrides = {} }) {
  const fast = fastPath(messageText);
  if (fast) return fast;

  const prompt = classificationPrompt(student?.name || 'the student', messageText, recentContext);

  try {
    const result = await callAIStructured({
      messages: [{ role: 'user', content: prompt }],
      model: appConfig.models.classifier,
      maxTokens: 300,
      reasoningEffort: appConfig.reasoningEffort.classifier,
      label: 'classify',
    }, CLASSIFICATION_SCHEMA, overrides);

    const category = String(result.category || '').toLowerCase();
    if (!['green', 'orange', 'red'].includes(category)) {
      return { category: 'orange', topic: result.topic || 'uncertain', is_academic: false, reason: 'classifier returned unknown category; defaulting to human review', source: 'llm' };
    }
    return {
      category,
      topic: result.topic || 'unknown',
      is_academic: Boolean(result.is_academic) && category === 'green',
      reason: result.reason || '',
      source: 'llm',
    };
  } catch (error) {
    // Classifier unavailable: favour human review for safety, per Phase 3 rules.
    return {
      category: 'orange',
      topic: 'classifier_error',
      is_academic: false,
      reason: `classification failed (${error.message}); routed to human review`,
      source: 'fallback',
    };
  }
}

// Responsibility 4 helper lives here too (it is the escalation decision's
// user-facing twin): the empathetic acknowledgement for ORANGE messages.
export async function generateEscalationAck({ student, classification, overrides = {} }) {
  const { escalationAckPrompt } = await import('./prompts.js');
  try {
    const res = await callAI({
      messages: [{
        role: 'user',
        content: escalationAckPrompt(student?.name || 'the student', classification?.topic || 'a personal matter'),
      }],
      model: appConfig.models.escalation,
      maxTokens: 150,
      temperature: 0.6,
      reasoningEffort: appConfig.reasoningEffort.escalation,
      label: 'escalation_ack',
    }, overrides);
    return res.content;
  } catch {
    // Deterministic fallback so a student ALWAYS gets a humane acknowledgement.
    const name = student?.name || 'there';
    return `Hey ${name}, I hear you. 💛 What you shared matters, and it deserves more than a quick reply from me — I've let Florryshine know, and she'll reach out to you here personally. I'm still right here with you in the meantime.`;
  }
}
