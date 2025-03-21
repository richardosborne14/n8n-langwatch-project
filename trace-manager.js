// trace-manager.js - Manages trace lifecycle
const { getTimestamp } = require('./utils/helpers');
const { LangWatchClient } = require('./langwatch-client');
const { logger } = require('./logger');

class TraceManager {
  constructor() {
    this.workflowExecutions = new Map();
    this.pendingNodeExecutions = new Map();
    this.client = new LangWatchClient();
  }
  
  /**
   * Create a new workflow execution trace
   * @param {Object} workflow - Workflow definition
   * @returns {Object} Execution data
   */
  createWorkflowExecution(workflow) {
    const workflowId = workflow?.id ?? "unknown";
    const workflowName = workflow?.name ?? "unknown";
    
    // Create a trace ID for this workflow execution
    const traceId = `wf-${workflowId}-${Date.now()}`;
    const startedAt = getTimestamp();
    
    // Create a new execution record with an empty spans array
    const executionData = {
      workflow,
      traceId,
      startedAt,
      nodes: new Map(),
      spans: [],
      isComplete: false
    };
    
    // Store the execution data by workflow ID
    this.workflowExecutions.set(workflowId, executionData);
    
    logger.debug(`Starting workflow: ${workflowName} (${traceId})`);
    
    // Check for any pending node executions for this workflow
    if (this.pendingNodeExecutions.has(workflowId)) {
      const pendingNodes = this.pendingNodeExecutions.get(workflowId);
      logger.debug(`Found ${pendingNodes.length} pending node executions for workflow ${workflowId}`);
      executionData.spans.push(...pendingNodes);
      this.pendingNodeExecutions.delete(workflowId);
    }
    
    return executionData;
  }
  
  /**
   * Get the current workflow execution for a workflow ID
   * @param {string} workflowId - Workflow ID
   * @returns {Object|null} Execution data or null if not found
   */
  getWorkflowExecution(workflowId) {
    return this.workflowExecutions.get(workflowId) || null;
  }
  
  /**
   * Add a span to a workflow execution
   * @param {string} workflowId - Workflow ID
   * @param {Object} span - Span data
   */
  addSpan(workflowId, span) {
    const execution = this.workflowExecutions.get(workflowId);
    
    if (execution) {
      execution.spans.push(span);
      logger.debug(`Added span for workflow ${workflowId}`);
    } else {
      // Store in pending executions
      if (!this.pendingNodeExecutions.has(workflowId)) {
        this.pendingNodeExecutions.set(workflowId, []);
      }
      this.pendingNodeExecutions.get(workflowId).push(span);
      logger.debug(`Added span to pending queue for workflow ${workflowId}`);
    }
  }
  
  /**
   * Complete a workflow execution
   * @param {string} workflowId - Workflow ID
   * @param {Object} result - Workflow execution result
   */
  completeWorkflowExecution(workflowId, result = null) {
    const executionData = this.workflowExecutions.get(workflowId);
    
    if (executionData) {
      const finishedAt = getTimestamp();
      const workflowName = executionData.workflow?.name || 'unknown';
      
      // Create a workflow span
      const workflowSpan = {
        type: "workflow",
        span_id: `${executionData.traceId}-workflow`,
        input: {
          type: "text",
          value: `Workflow: ${workflowName}`
        },
        output: {
          type: "json",
          value: result ? 
            (result.error ? { error: result.error } : { success: true }) : 
            { success: true }
        },
        timestamps: {
          started_at: executionData.startedAt,
          finished_at: finishedAt
        }
      };
      
      // Add workflow span to collection
      executionData.spans.push(workflowSpan);
      executionData.isComplete = true;
      
      // Send all spans to LangWatch
      this.sendWorkflowToLangWatch(executionData);
    }
  }
  
  /**
   * Send a workflow execution to LangWatch
   * @param {Object} executionData - Workflow execution data
   */
  async sendWorkflowToLangWatch(executionData) {
    try {
      const workflow = executionData.workflow;
      const traceId = executionData.traceId;
      
      logger.debug(`Sending ${executionData.spans.length} spans for workflow ${workflow.id}`);
      
      // Create trace data for LangWatch
      const traceData = {
        trace_id: traceId,
        spans: executionData.spans,
        metadata: {
          user_id: "n8n-system",
          thread_id: `workflow-${workflow.id}`,
          labels: ["n8n", `workflow-${workflow.id}`, workflow.name]
        }
      };
      
      // Send to LangWatch
      await this.client.sendTrace(traceData);
      logger.info(`Sent workflow execution trace to LangWatch: ${traceId}`);
      
      // Clean up execution data
      this.workflowExecutions.delete(workflow.id);
    } catch (error) {
      logger.error(`Error sending workflow spans: ${error.message}`);
    }
  }
  
  /**
   * Flush any pending traces before shutdown
   */
  async flushPendingTraces() {
    logger.info(`Flushing ${this.workflowExecutions.size} pending workflow executions`);
    
    const promises = [];
    for (const [workflowId, executionData] of this.workflowExecutions.entries()) {
      if (!executionData.isComplete) {
        // Complete the workflow with no result
        this.completeWorkflowExecution(workflowId);
      } else {
        // If already complete but not sent, send it now
        promises.push(this.sendWorkflowToLangWatch(executionData));
      }
    }
    
    try {
      await Promise.all(promises);
      logger.info('All pending traces flushed');
    } catch (error) {
      logger.error(`Error flushing pending traces: ${error.message}`);
    }
  }
}

module.exports = { TraceManager };