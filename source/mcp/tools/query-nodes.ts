import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { McpServerManager } from "../server-manager";
import { getComponentInfo } from "../utils";

export function registerQueryNodesTool(server: McpServer): void {
  server.registerTool(
    "query_nodes",
    {
      title: "Query Node Hierarchy",
      description: "Inspects node hierarchy with flexible detail levels. Supports granular control over what information to include and depth limiting for performance.",
      inputSchema: {
        nodeUuid: z.string().optional().describe("Optional: specific node UUID (defaults to scene root)"),
        includeProperties: z.boolean().default(false).describe("Include node transform/basic properties"),
        includeComponents: z.boolean().default(false).describe("Include component list"),
        includeComponentProperties: z.boolean().default(false).describe("Include full component property details"),
        maxDepth: z.number().optional().describe("Limit hierarchy depth (default: unlimited)"),
      }
    },
    async (args) => {
      const { nodeUuid, includeProperties, includeComponents, includeComponentProperties, maxDepth } = args;
      const errors: string[] = [];

      try {
        let nodeTree: any = null;
        
        if (nodeUuid) {
          // Query specific node
          const decodedUuid = McpServerManager.decodeUuid(nodeUuid);
          nodeTree = await Editor.Message.request('scene', 'query-node-tree', decodedUuid);
          
          if (!nodeTree) {
            errors.push(`Node with UUID ${nodeUuid} not found`);
          }
        } else {
          // Get root scene node
          nodeTree = await Editor.Message.request('scene', 'query-node-tree');
          if (!nodeTree) {
            errors.push("No scene loaded");
          }
        }

        if (!nodeTree) {
          const result = {
            operation: "query-nodes",
            hierarchy: null,
            errors
          };

          return {
            content: [{
              type: "text",
              text: JSON.stringify(result)
            }]
          };
        }

        // Build hierarchy tree recursively with requested detail level
        const buildHierarchy = async (node: any, currentDepth: number = 0): Promise<any> => {
          const nodeUuid = node.uuid?.value || node.uuid;
          let nodeDetails: any = node;
          
          if (!nodeUuid) {
            errors.push("Node does not have a valid UUID");
            return null; // Skip this node if no U
            // UID is available
          }
          try {
            nodeDetails = await Editor.Message.request('scene', 'query-node', nodeUuid);
            if (!nodeDetails) {
              nodeDetails = node; // Fallback to basic info
            }
          } catch (queryError) {
            errors.push(`Failed to query node details for ${nodeUuid}: ${queryError instanceof Error ? queryError.message : String(queryError)}`);
          }
          
          const result: any = {
            name: nodeDetails.name?.value || nodeDetails.name || "Unnamed Node",
            uuid: McpServerManager.encodeUuid(nodeUuid),
          };

          // Include basic node properties if requested
          if (includeProperties) {
            result.properties = {
              position: nodeDetails.position?.value || nodeDetails.position || { x: 0, y: 0, z: 0 },
              eulerAngles: nodeDetails.rotation?.value || nodeDetails.rotation || { x: 0, y: 0, z: 0 },
              scale: nodeDetails.scale?.value || nodeDetails.scale || { x: 1, y: 1, z: 1 },
              enabled: nodeDetails.active?.value ?? nodeDetails.active ?? true,
              layer: nodeDetails.layer?.value || nodeDetails.layer || 0,
              mobility: nodeDetails.mobility?.value || nodeDetails.mobility || 0
            };
          }

          // Handle components
          let nodeComponents: any[] = [];
          // Use detailed node info for components if available, otherwise fallback to tree info
          const componentSource = nodeDetails.__comps__ || node.__comps__ || node.components || [];
          if (componentSource && componentSource.length > 0) {
            nodeComponents = componentSource.map((component: any) => ({
              name: component.value?.name?.value || component.value?.name || component.name || component.type,
              uuid: McpServerManager.encodeUuid(component.value?.uuid?.value || component.value?.uuid || component.uuid),
              type: component.value?.name?.value || component.value?.name || component.name || component.type
            }));
          }

          // Include components if requested
          if (includeComponents && nodeComponents.length > 0) {
            result.components = [];
            
            for (const comp of nodeComponents) {
              const componentInfo: any = {
                uuid: comp.uuid,
                type: comp.type
              };

              // Include component properties if requested
              if (includeComponentProperties) {
                try {
                  const componentDetails = await getComponentInfo(comp.uuid, true, false);
                  if (componentDetails.properties) {
                    componentInfo.properties = componentDetails.properties;
                  }
                } catch (compError) {
                  errors.push(`Failed to get properties for component ${comp.uuid}: ${compError instanceof Error ? compError.message : String(compError)}`);
                }
              }

              result.components.push(componentInfo);
            }
          }

          // Add children recursively if within depth limit
          const shouldIncludeChildren = maxDepth === undefined || currentDepth < maxDepth;
          if (shouldIncludeChildren && ((node.children && node.children.length > 0) || (node.__children__ && node.__children__.length > 0))) {
            const children = node.children || node.__children__;
            result.children = [];
            
            for (const child of children) {
              try {
                const childResult = await buildHierarchy(child, currentDepth + 1);
                if (childResult !== null) { // Only include if not filtered out
                  result.children.push(childResult);
                }
              } catch (childError) {
                errors.push(`Error querying child node: ${childError instanceof Error ? childError.message : String(childError)}`);
              }
            }

            // Remove empty children array
            if (result.children.length === 0) {
              delete result.children;
            }
          }

          return result;
        };

        const hierarchy = await buildHierarchy(nodeTree);

        const result = {
          operation: "query-nodes",
          hierarchy,
          requestedDetail: {
            includeProperties,
            includeComponents,
            includeComponentProperties,
            maxDepth
          },
          errors: errors.length > 0 ? errors : undefined
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result)
          }]
        };

      } catch (error) {
        const result = {
          operation: "query-nodes",
          hierarchy: null,
          errors: [`Error querying nodes: ${error instanceof Error ? error.message : String(error)}`]
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result)
          }]
        };
      }
    }
  );
}
