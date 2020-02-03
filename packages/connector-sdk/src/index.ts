export { default as AuthorizedRegistryClient } from "@magda/typescript-common/dist/registry/AuthorizedRegistryClient";
export { Record } from "@magda/typescript-common/dist/generated/registry/api";
export { default as ConnectorRecordId } from "@magda/typescript-common/dist/ConnectorRecordId";
export { default as cleanOrgTitle } from "@magda/typescript-common/dist/util/cleanOrgTitle";
export {
    default as JsonConnector,
    ConnectorSource,
    JsonConnectorOptions,
    JsonConnectorRunInteractiveOptions,
    JsonConnectorConfig
} from "@magda/typescript-common/dist/JsonConnector";
export {
    default as JsonTransformer,
    buildersToCompiledAspects,
    JsonTransformerOptions,
    CompiledAspects,
    BuilderSetupFunctionParameters,
    BuilderFunctionParameters
} from "@magda/typescript-common/dist/JsonTransformer";
import AspectBuilder from "@magda/typescript-common/dist/AspectBuilder";
export { AspectBuilder };
export const TenantConsts = require("@magda/typescript-common/dist/registry/TenantConsts");
