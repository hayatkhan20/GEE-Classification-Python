// Land cover parameters
var values = [10, 20, 30, 40, 50, 60, 70, 80, 100];
var palette = ['006400', 'ffbb22', 'ffff4c', 'f096ff', 'fa0000', 'b4b4b4', 'f0f0f0', '0064c8', 'fae6a0'];
var names = ['Tree cover', 'Shrubland', 'Grassland', 'Cropland', 'Built-up', 'Bare or sparse vegetation', 'Snow and ice', 'Permanent water bodies', 'Moss and lichen'];

// Show legend
legend(palette, values, names);

// Land cover dictionary for visualization
var lulcDict = {
  'LULC_class_palette': palette,
  'LULC_class_values': values,
  'LULC_class_names': names
};

// Land cover data for 2014 and 2018
var lulc2014 = ee.Image('projects/ee-hayatabid/assets/landcover2014');
var lulc2018 = ee.Image('projects/ee-hayatabid/assets/landcover2018');

// DEM data
var srtm = ee.Image('projects/ee-hayatabid/assets/DEM');

// Road and drainage data (assuming these are already rasterized)
var distanceToRoads = ee.Image('projects/ee-hayatabid/assets/Roads').rename('distance_to_roads');
var distanceToDrainage = ee.Image('projects/ee-hayatabid/assets/Drainaige').rename('distance_to_drainage');

// Region of interest
var roi = ee.FeatureCollection('projects/ee-hayatabid/assets/Jehlum_Chenab');

// Clip the land cover images to the ROI
lulc2014 = lulc2014.clip(roi);
lulc2018 = lulc2018.clip(roi);

// Put the land cover in a list
var lulcList = [
  { year: 2014, image: lulc2014 },
  { year: 2018, image: lulc2018 }
];

// Show the 2014 and 2018 land cover
lulcList.map(function(dict){
  Map.addLayer(dict.image.set(lulcDict), {}, 'LULC ' + dict.year);
});

// Create land cover change map
var changeValues = [];
var changeNames = [];
var changeMap = ee.Image(0);
values.map(function(value1, index1){
  values.map(function(value2, index2){
    var changeValue = value1 * 1e2 + value2;
    changeValues.push(changeValue);
    
    var changeName = names[index1] + ' -> ' + names[index2];
    changeNames.push(changeName);
    
    changeMap = changeMap.where(lulcList[0].image.eq(value1).and(lulcList[1].image.eq(value2)), changeValue);
  });
});

// Show the change map
changeMap = changeMap.selfMask();
Map.addLayer(changeMap, { min: 1010, max: 100100, palette: palette }, 'Land cover change map');

// Print the change dictionary
var changeDict = ee.Dictionary.fromLists(changeValues.map(function(value){ return String(value) }), changeNames);
print('Land cover change values', changeDict);

// Create images with variables to predict land cover change
var variables = ee.Image([
  lulc2014.rename('start'),
  lulc2018.rename('end'),
  changeMap.rename('transition'),
  srtm.clip(roi).rename('elevation'),
  distanceToRoads.clip(roi),
  distanceToDrainage.clip(roi),
  ee.Image(2018).subtract(2014).rename('year')
]);

// Debugging prints for variables
print('Variables image:', variables);

// Property names for prediction
var propNames = ['start', 'transition', 'elevation', 'distance_to_roads', 'distance_to_drainage', 'year'];

// Property name to predict
var predictName = 'end';

// Sample image
var sample = variables.stratifiedSample({
  numPoints: 1000, // Reduce the number of points sampled to avoid memory issues
  classBand: 'transition', 
  scale: 30,
  region: roi
}).randomColumn();

// Debugging prints for sample
print('Sample:', sample);

// Split train and test
var train = sample.filter(ee.Filter.lte('random', 0.8));
var test = sample.filter(ee.Filter.gt('random', 0.8));
print(
  ee.String('Sample train: ').cat(ee.String(train.size())),
  ee.String('Sample test: ').cat(ee.String(test.size()))
);

// Build random forest model for prediction
var model = ee.Classifier.smileRandomForest(50).train(train, predictName, propNames);

// Test model accuracy
var cm = test.classify(model, 'prediction').errorMatrix('end', 'prediction');
print(
  'Confusion matrix', cm,
  ee.String('Accuracy: ').cat(ee.String(cm.accuracy())),
  ee.String('Kappa: ').cat(ee.String(cm.kappa()))
);

// Variables to predict for year 2030
var variables2030 = ee.Image([
  lulc2018.rename('start'),
  changeMap.rename('transition'),
  srtm.clip(roi).rename('elevation'),
  distanceToRoads.clip(roi),
  distanceToDrainage.clip(roi),
  ee.Image(2030).subtract(2018).rename('year')
]);

// Apply the model for the variables for 2030
var lulc2030 = variables2030.classify(model, 'LULC').set(lulcDict);
Map.addLayer(lulc2030, {}, 'LULC 2030 Prediction');

// Debugging prints for lulc2030
print('LULC 2030 Prediction:', lulc2030);

// Add lulc 2030 to LULC list
lulcList.push({ year: 2030, image: lulc2030 });

// Calculate land cover area per year
var lulcAreafeatures = ee.FeatureCollection(lulcList.map(function(dict){
  var imageArea = ee.Image.pixelArea().divide(10000);
  var reduceArea = imageArea.addBands(dict.image).reduceRegion({
    reducer: ee.Reducer.sum().setOutputs(['area']).group(1, 'class'),
    scale: 30,
    geometry: roi,
    bestEffort: true
  }).get('groups');
  
  var features = ee.FeatureCollection(ee.List(reduceArea).map(function(dictionary){
    dictionary = ee.Dictionary(dictionary);
    var classIndex = ee.Number(dictionary.get('class')).divide(10).subtract(1).int();
    classIndex = classIndex.min(names.length - 1); // Ensure the index does not go out of bounds
    var label = ee.List(names).get(classIndex);
    dictionary = dictionary.set('year', ee.Number(dict.year).toInt());
    dictionary = dictionary.set('LULC', label);
    return ee.Feature(null, dictionary);
  }));
  
  return features;
})).flatten();

// Debugging prints for lulcAreafeatures
print('LULC Area Features:', lulcAreafeatures);

// Make chart for land cover area change
var chartArea = ui.Chart.feature.groups(lulcAreafeatures, 'year', 'area', 'LULC')
  .setOptions({
    title: 'LULC area changes 2014 - 2018 - 2030'
  });
print(chartArea);

// Function to add legend
function legend(palette, values, names){
  Map.add(
    ui.Panel(
      palette.map(function(color, index){
        return ui.Panel([
          ui.Label('', { backgroundColor: color, width: '30px', height: '20px' }),
          ui.Label(values[index], { height: '20px' }),
          ui.Label(names[index], { height: '20px' })
        ], ui.Panel.Layout.flow('horizontal'));
      }),
      ui.Panel.Layout.flow('vertical'),
      { position: 'bottom-left' }
    )
  );
}
