/** Contrato de integração futura: nenhum token do chat é reutilizado pela aplicação. */
export type AuthorizedFinancialSource = {
  provider:'gmail'; ownerId:string; consentId:string;
  permission:'read-only'; from:string; until:string;
};
export type StructuredSourceEvent = {
  sourceHash:string; amount:string; date:string;
  kind:'income'|'expense'; description:string;
  eventType:'charged'|'paid'|'predicted';
};
export interface FinancialConnector {
  discover(scope:AuthorizedFinancialSource):AsyncIterable<StructuredSourceEvent>;
  revoke(ownerId:string):Promise<void>;
}
export const connectorStatus={gmail:{connected:false,enabled:false,reason:'Requer OAuth próprio, consentimento e avaliação das políticas do provedor.'}} as const;
