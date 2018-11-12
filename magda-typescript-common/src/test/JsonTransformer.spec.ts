import JsonTransformer, { JsonTransformerOptions } from "src/JsonTransformer";
import ConnectorRecordId from "src/ConnectorRecordId";
import { expect } from "chai";
import "mocha";
import AspectBuilder from "src/AspectBuilder";
import * as fs from "fs";
import cleanOrgTitle from "src/util/cleanOrgTitle";
import * as moment from "moment";
import * as URI from "urijs";
import { Record } from "src/generated/registry/api";

describe("JsonTransformer", () => {
    describe("organizationJsonToRecord", () => {
        let transformerOptions: JsonTransformerOptions;

        beforeEach(() => {
            const organizationAspectBuilders: AspectBuilder[] = [
                {
                    aspectDefinition: {
                        id: "source",
                        name: "Source",
                        jsonSchema: require("@magda/registry-aspects/source.schema.json")
                    },
                    builderFunctionString: fs.readFileSync(
                        "src/test/aspect-templates/organization-source.js",
                        "utf8"
                    )
                },
                {
                    aspectDefinition: {
                        id: "organization-details",
                        name: "Organization",
                        jsonSchema: require("@magda/registry-aspects/organization-details.schema.json")
                    },
                    builderFunctionString: fs.readFileSync(
                        "src/test/aspect-templates/organization-details.js",
                        "utf8"
                    )
                }
            ];

            transformerOptions = {
                sourceId: "test",
                organizationAspectBuilders,
                libraries: {
                    cleanOrgTitle: cleanOrgTitle,
                    moment: moment,
                    URI: URI
                }
            };
        });

        it("should only revise the specific descrition", () => {
            const transformer = new JsonTransformerWithCheck(
                transformerOptions
            );
            const organization = JSON.parse(
                '{"description": "This description should be revised as an empty string.", \
                "id": "123", "name": "abc", "type": "organization"}'
            );
            const theRecord = transformer.organizationJsonToRecord(
                organization
            );
            expect(theRecord.id).to.equal("org-test-123");
            expect(theRecord.name).to.equal("abc");

            const sourceAspect = theRecord.aspects["source"];
            expect(sourceAspect.id).to.equal("test source id");
            expect(sourceAspect.name).to.equal("test source name");
            expect(sourceAspect.type).to.equal("test source organization");
            expect(sourceAspect.url).to.equal("http://test.com");

            const organizationDetailsAspect =
                theRecord.aspects["organization-details"];
            expect(organizationDetailsAspect.description).to.equal("");
            expect(organizationDetailsAspect.name).to.equal("abc");
        });

        it("should not revise the non-specific descrition", () => {
            const transformer = new JsonTransformerWithCheck(
                transformerOptions
            );
            const organization = JSON.parse(
                '{"description": "This description should be kept.", \
                "id": "456", "name": "def", "type": "organization"}'
            );
            const theRecord = transformer.organizationJsonToRecord(
                organization
            );
            expect(
                theRecord.aspects["organization-details"].description
            ).to.equal("This description should be kept.");
        });

        it("should not revise any descrition when reviseOrganizationRecord does nothing", () => {
            const transformer = new JsonTransformerWithoutCheck(
                transformerOptions
            );
            const organization = JSON.parse(
                '{"description": "This description should be kept.", \
                "id": "123456", "name": "abc def", "type": "organization"}'
            );
            const theRecord = transformer.organizationJsonToRecord(
                organization
            );
            expect(
                theRecord.aspects["organization-details"].description
            ).to.equal("This description should be kept.");
        });
    });
});

class JsonTransformerWithCheck extends JsonTransformer {
    getIdFromJsonOrganization(
        jsonOrganization: any,
        sourceId: string
    ): ConnectorRecordId {
        return new ConnectorRecordId(
            jsonOrganization.id,
            "Organization",
            sourceId
        );
    }

    getNameFromJsonOrganization(jsonOrganization: any): string {
        return jsonOrganization.name;
    }

    reviseOrganizationRecord(record: Record): Record {
        if (
            record.aspects["organization-details"] &&
            record.aspects["organization-details"].description ==
                "This description should be revised as an empty string."
        ) {
            record.aspects["organization-details"].description = "";
        }

        return record;
    }

    getIdFromJsonDataset(
        jsonDataset: any,
        sourceId: string
    ): ConnectorRecordId {
        throw new Error("Method not implemented.");
    }
    getIdFromJsonDistribution(
        jsonDistribution: any,
        jsonDataset: any,
        sourceId: string
    ): ConnectorRecordId {
        throw new Error("Method not implemented.");
    }
    getNameFromJsonDataset(jsonDataset: any): string {
        throw new Error("Method not implemented.");
    }
    getNameFromJsonDistribution(
        jsonDistribution: any,
        jsonDataset: any
    ): string {
        throw new Error("Method not implemented.");
    }
}

class JsonTransformerWithoutCheck extends JsonTransformerWithCheck {
    reviseOrganizationRecord(record: Record) {
        return record;
    }
}
