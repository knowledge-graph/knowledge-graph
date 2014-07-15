"use strict";

var dagreD3 = require('dagre-d3');
var d3 = require('d3');

/*

Given a JSON object with the knowledge data, create a graph object which
will be rendered by dagre-d3.

json: TODO describe what the json should look like

*/
var createGraph = function(kg, json) {
  var graph = kg.graph = new dagreD3.Digraph();
  if (!json)
    return;

  if (json.concepts) {
    // Add all the concepts as nodes
    json.concepts.forEach(function(concept) {
      kg.addConcept({concept: concept});
    });
  }

  if (json.dependencies) {
    json.dependencies.forEach(function(dep) {
      kg.addDependency(dep);
    });
  }

  return graph;
};

/*

Creates the points for the paths that make up the edges
Offsets the in/out edges to above/below given nodes

Replaces the default dagre-d3 PositionEdgePaths function
*/
function positionEdgePaths(g, svgEdgePaths) {
  // Add an ID to each edge
  svgEdgePaths
    .attr('id', function(d) { return d; });

  var interpolate = this._edgeInterpolate,
      tension = this._edgeTension;

  function calcPoints(e) {
    var value = g.edge(e);
    var source = g.node(g.incidentNodes(e)[0]);
    var target = g.node(g.incidentNodes(e)[1]);
    var points = value.points.slice();

    var p0 = points.length === 0 ? target : points[0];
    var p1 = points.length === 0 ? source : points[points.length - 1];

    points.unshift(nodePosition(source, p0));
    points.push(nodePosition(target, p1));

    return d3.svg.line()
      .x(function(d) { return d.x; })
      .y(function(d) { return d.y; })
      .interpolate(interpolate)
      .tension(tension)
      (points);
  }

  svgEdgePaths.filter('.enter').selectAll('path')
      .attr('d', calcPoints);

  this._transition(svgEdgePaths.selectAll('path'))
      .attr('d', calcPoints)
      .style('opacity', 1);
}

function nodePosition(node, point) {
  var x = node.x;
  var y = node.y;
  var r = 25;
  
  var dx = point.x - x;
  var dy = point.y - y;

  // Length of the line from the circle to the point
  var l = Math.sqrt(dx*dx + dy*dy);
  // Unit values
  var dxu = dx/l;
  var dyu = dy/l;

  // Offset above/below depending whether the line is up or down
  var offset = ((dy > 0) ? 1 : -1) * node.height/4;

  return {x: x + dxu*r, y: y + offset + dyu*r}; 
}

/*

Adds entry and exit points for edges into concept elements

Used in addition to the default node rendering function

*/
function drawHamburgers(graph, nodes) {
  var kg = this;

  // Create a semi-circle path function
  var semicircle = d3.svg.arc()
    .outerRadius(20)
    .startAngle(3*Math.PI/2)
    .endAngle(5*Math.PI/2);

  // Add enter/above
  var enter = nodes.insert('path', 'rect')
    .classed('enter', true)
    .attr('d', semicircle)
    .attr('transform', function() {
      return 'translate(0,' + (-nodes.selectAll('rect').attr('height')/2) + ')';
    });

  // Flip the semi-circle
  semicircle
    .startAngle(Math.PI/2)
    .endAngle(3*Math.PI/2);
  
  // Add exit/below
  var exit = nodes.insert('path', 'rect')
    .classed('exit', true)
    .attr('d', semicircle)
    .attr('transform', function() {
      return 'translate(0,' + (nodes.selectAll('rect').attr('height')/2) + ')';
    });
}

/*

Construct a knowledge map object.

Accepts a single object:
  config: an object that contains the data about the graph and various other
  options
  The available options are:
    graph: a JSON object that contains the graph data
    plugins: a list of plugin names or plugin objects

*/
var KnowledgeMap = function(api, config) {
  config = config || {};
  this.config = config;

  /*
  Message API
  */
  this.dispatcher = {};

  this.postEvent = function(e) {
    if(this.dispatcher[e.type]) {
      var callbacks = this.dispatcher[e.type];
      callbacks.forEach(function(callback) {
        callback(e);
      });
    }
  };

  this.onEvent = function(type, callback) {
    if(undefined === this.dispatcher[type]) {
      this.dispatcher[type] = [];
    }
    this.dispatcher[type].push(callback);
  };

  /*
  Adds a concept to the graph and then updates the graph rendering

  config:
    concept: The concept object to add
    dependents: A list of concept ids dependent on this one
  */
  this.addConcept = function(config) {
    var kg = this;
    window.kg = kg;

    // Add node to the graph
    this.graph.addNode(config.concept.id, {
      label: config.concept.name,
      concept: config.concept,
    });

    // Add dependent edges to the graph
    if (config.dependents) {
      config.dependents.forEach(function(dep) {
        kg.addDependency({
          concept: kg.graph.node(dep).concept,
          dependency: config.concept.id,
        });
      });
    }

    // Add dependency edges to the graph
    if (config.concept.dependencies) {
      config.concept.dependencies.forEach(function(dep) {
        kg.addDependency({
          concept: config.concept,
          dependency: dep,
        });
      });
    }

    // Update the graph display
    this.render();
  };

  /*

  Adds a dependency to the graph and then updates the graph rendering

  config:
    concept: the concept which depends on another concept
    dependency: the id of the concept which is depended on

  */
  this.addDependency = function(config) {
    // Get ids of the concepts
    var concept = config.concept;
    var dep = config.dependency;

    // Add the dependency to the list of the concept's dependencies
    if (concept.dependencies && concept.dependencies.indexOf(dep) === -1) {
      concept.dependencies.push(dep);
    } else {
      concept.dependencies = [dep];
    }

    // Add the edge to the graph
    this.graph.addEdge(dep+'-'+concept.id, dep, concept.id, { dependency: config });

    // Update the graph display
    this.render();
  };

  /*

  Removes a dependency from the graph and then updates the graph rendering

  */
  this.removeDependency = function(config) {
    if (config.concept) {
      // Get ids of concepts
      var con = config.concept;
      var dep = config.dependency;

      // Remove the dependency from the concept
      var concept = this.graph.node(con).concept;
      if (concept.dependencies) {
        var index = concept.dependencies.indexOf(dep);
        concept.dependencies.splice(index, 1);
      }

      // Remove the edge from the graph
      this.graph.delEdge(dep+'-'+con);
    } else {
      var dep = this.graph.edge(config.dependency).dependency;
      this.removeDependency({
        concept: dep.concept.id,
        dependency: dep.dependency
      });
    }

    // Update the graph display
    this.render();
  };

  /*
  
  Returns true if the graph has this dependency and false otherwise

  */
  this.hasDependency = function(config) {
    // Get ids of concepts
    var concept = config.concept;
    var dep = config.dependency;

    // Return true if edge exists
    return this.graph.hasEdge(dep+'-'+concept);
  };

  /*

  Renders/rerenders the graph elements

  */
  this.render = function() {
    // Run the renderer
    this.renderer.run(this.graph, this.element);
  };

  /*

  Outputs the graph as a JSON object

  */
  this.toJSON = function() {
    var json = {
      concepts: [],
    };

    // Add all of the concepts
    this.graph.eachNode(function(id, node) {
      json.concepts.push(node.concept);
    });

    return JSON.stringify(json);
  };
  
  /*

  Deletes a concept from the graph

  */
  this.removeConcept = function(conceptId) {
    var kg = this;
    var concept = kg.graph.node(conceptId).concept;

    // Remove all links to concepts that this one depends on
    if(concept.dependencies) {
      concept.dependencies.forEach(function(dependency) {
        kg.removeDependency({
          concept: conceptId,
          dependency: dependency,
        });
      });
    }

    // Remove all links to concepts that depend on this
    var dependants = kg.getDependants(conceptId);
    if(dependants.length) {
      dependants.forEach(function(dependant) {
        kg.removeDependency({
          concept: dependant,
          dependency: conceptId,
        });
      });
    }

    // Remove the node
    kg.graph.delNode(conceptId);

    // Update the display
    this.render();
  };

  /*

  Return a list of IDs of concepts that depend on a given concept, i.e.
  have this concept as a dependency

  */
  this.getDependants = function(conceptId) {
    return this.graph.successors(conceptId);
  };

  /*

  Add a piece of content to a concept

  */
  this.addContent = function(conceptId, content) {
    var concept = this.graph.node(conceptId).concept;
    if(concept.content) {
      concept.content.push(content);
    } else {
      concept.content = [content];
    }
  };

  /*

  Update a piece of content in a concept

  */
  this.updateContent = function(conceptId, contentIndex, content) {
    var concept = this.graph.node(conceptId).concept;
    if(contentIndex >= concept.content.length) {
      this.addContent(conceptId, content);
    } else {
      concept.content[contentIndex] = content;
    }
  };

  /*

  Remove a piece of content from a concept

  */
  this.removeContent = function(conceptId, contentIndex) {
    var concept = this.graph.node(conceptId).concept;
    concept.content.splice(contentIndex, 1);
  };

  // Initialise plugins for graph.
  if(config && config.plugins) {
    for(var i = 0; i < config.plugins.length; i++) {
      var plugin = config.plugins[i];
      if('string' === typeof(plugin)) {
        plugin = api.plugins[plugin];
      }
      if(plugin && plugin.run) {
        plugin.run(this);
      }
    }
    this.__defineGetter__('plugins', function() {
      return config.plugins;
    });
    this.__defineSetter__('plugins', function() {});
  }

  // Create an element on the page for us to render our graph in
  var parentName = config.inside || 'body';
  var element = this.element = d3.select(parentName).append('svg');

  // Use dagre-d3 to render the graph
  var renderer = this.renderer = new dagreD3.Renderer();
  var layout   = this.layout   = dagreD3.layout().rankSep(50);
  if (config.layout) {
    if (config.layout.verticalSpace)   layout.rankSep(config.layout.verticalSpace);
    if (config.layout.horizontalSpace) layout.nodeSep(config.layout.horizontalSpace);
    if (config.layout.direction)       layout.rankDir(config.layout.direction);
  }

  // Update the way edges are positioned
  renderer.layout(layout);
  renderer.positionEdgePaths(positionEdgePaths);

  // Add transitions for graph updates
  renderer.transition(function(selection) {
    var duration = config.transitionDuration || 500;

      return selection
        .transition()
          .duration(duration);
  });

  var kg = this;
  var _renderData = {};

  var drawNodes = renderer.drawNodes();
  renderer.drawNodes(function(graph, element) {
    var nodes = drawNodes(graph, element);

    // Add class labels
    nodes.attr('id', function(d) { return d; });

    // Add burger buns
    drawHamburgers.call(kg, graph, nodes);

    _renderData.nodes = nodes;
    return nodes;
  });

  var drawEdgePaths = renderer.drawEdgePaths();
  renderer.drawEdgePaths(function(graph, element) {
    var edges = drawEdgePaths(graph, element);
    _renderData.edges = edges;
    return edges;
  });

  var postRender = renderer.postRender();
  renderer.postRender(function(result, root) {
    var res = postRender(result, root);
    kg.postEvent({
      type: 'renderGraph',
      graph: kg.graph,
      result: result,
      nodes: _renderData.nodes,
      edges: _renderData.edges
    });
    return res;
  });

  // Create the directed graph
  var graph = createGraph(this, config.graph);

  // Display the graph
  this.render();

  return this;
};

/*

Public API for the knowledge-map library

*/
var api = {
  /*

  Create a knowledge map display that layouts out the entire graph.

  */
  create: function(config) {
    return new KnowledgeMap(this, config);
  },

  plugins: {
    'links': require('./links-plugin.js'),
    'editing': require('./editing-plugin.js'),
    'modals': require('./modals-plugin.js'),
    'editing-modals': require('./editing-modals-plugin.js'),
    'click-events': require('./click-events-plugin.js'),
  },

  registerPlugin: function(plugin) {
    if(plugin && plugin.name && plugin.run) {
      this.plugins[plugin.name] = plugin;
    }
  }
};

global.knowledgeMap = api; 
module.exports = api;
