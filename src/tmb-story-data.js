export const TMB_STAGES = [
  {
    day: 1,
    title: "Stage 1: Chamonix to Les Contamines",
    distanceKm: 31.0,
    elevationGainM: 1450,
    elevationLossM: 1250,
    gpxFile: "/gpx/tmb-day-1.gpx",
    startName: "Chamonix Center",
    endName: "Les Contamines",
    restDay: false,
    stats: {
      distance: "19.3 mi",
      gain: "+4,750 ft",
      loss: "-4,100 ft",
      peak: "Col de Voza (5,420 ft)",
      duration: "approx. 6.5 hours"
    },
    photos: [
      {
        id: "day1-start",
        lat: 45.92349,
        lon: 6.86898,
        title: "Chamonix Church Start",
        desc: "Starting point in the historic church square of Chamonix-Mont-Blanc under sunny blue skies.",
        img: "/photos/chamonix_valley.png",
        timestamp: "08:00 AM"
      }
    ]
  },
  {
    day: 2,
    title: "Stage 2: Les Contamines to Les Chapieux",
    distanceKm: 20.0,
    elevationGainM: 1600,
    elevationLossM: 1550,
    gpxFile: "/gpx/tmb-day-2.gpx",
    startName: "Les Contamines",
    endName: "Les Chapieux",
    restDay: false,
    stats: {
      distance: "12.4 mi",
      gain: "+5,250 ft",
      loss: "-5,100 ft",
      peak: "Col du Bonhomme (7,640 ft)",
      duration: "approx. 7.5 hours"
    },
    photos: [
      {
        id: "day2-bonhomme",
        lat: 45.72803,
        lon: 6.71052,
        title: "Col du Bonhomme summit",
        desc: "Standing at the high alpine pass, looking down at the winding valley below with dramatic summer clouds.",
        img: "/photos/col_de_la_seigne.png",
        timestamp: "12:30 PM"
      }
    ]
  },
  {
    day: 3,
    title: "Stage 3: Les Chapieux to Courmayeur",
    distanceKm: 30.0,
    elevationGainM: 1550,
    elevationLossM: 1600,
    gpxFile: "/gpx/tmb-day-3.gpx",
    startName: "Les Chapieux",
    endName: "Courmayeur",
    restDay: false,
    stats: {
      distance: "18.6 mi",
      gain: "+5,100 ft",
      loss: "-5,250 ft",
      peak: "Col de la Seigne (8,250 ft)",
      duration: "approx. 8 hours"
    },
    photos: [
      {
        id: "day3-seigne",
        lat: 45.74483,
        lon: 6.79154,
        title: "Col de la Seigne border pass",
        desc: "Crossing the border from France into Italy. The breathtaking view of the Italian Val Ferret opens up.",
        img: "/photos/col_de_la_seigne.png",
        timestamp: "11:15 AM"
      },
      {
        id: "day3-seigne-marker",
        lat: 45.74483,
        lon: 6.79154,
        title: "Col de la Seigne boundary stone",
        desc: "The stone marker demarcating the high boundary between Savoie (France) and Valle d'Aosta (Italy).",
        img: "/photos/col_de_la_seigne.png",
        timestamp: "11:20 AM"
      },
      {
        id: "day3-combal",
        lat: 45.76317,
        lon: 6.83630,
        title: "Lac du Combal flat valley",
        desc: "A stunning glacier delta marshland with turquoise streams and massive terminal moraines.",
        img: "/photos/lac_du_combal.png",
        timestamp: "01:00 PM"
      }
    ]
  },
  {
    day: 4,
    title: "Stage 4: Rest Day in Courmayeur",
    distanceKm: 0.0,
    elevationGainM: 0,
    elevationLossM: 0,
    gpxFile: null,
    startName: "Courmayeur Center",
    endName: "Courmayeur Center",
    restDay: true,
    stats: {
      distance: "0.0 mi",
      gain: "0 ft",
      loss: "0 ft",
      peak: "Courmayeur Town (4,000 ft)",
      duration: "Rest and recovery"
    },
    photos: [
      {
        id: "day4-rest-town",
        lat: 45.79062,
        lon: 6.97197,
        title: "Courmayeur Piazza",
        desc: "Exploring the stone streets and historic cafes of Courmayeur, Italy. Enjoying pizza, gelato, and Alpine architecture.",
        img: "/photos/chamonix_valley.png",
        timestamp: "10:30 AM"
      }
    ]
  },
  {
    day: 5,
    title: "Stage 5: Courmayeur to La Fouly",
    distanceKm: 34.0,
    elevationGainM: 1800,
    elevationLossM: 1650,
    gpxFile: "/gpx/tmb-day-5.gpx",
    startName: "Courmayeur",
    endName: "La Fouly",
    restDay: false,
    stats: {
      distance: "21.1 mi",
      gain: "+5,900 ft",
      loss: "-5,400 ft",
      peak: "Grand Col Ferret (8,320 ft)",
      duration: "approx. 8.5 hours"
    },
    photos: [
      {
        id: "day5-bonatti",
        lat: 45.84693,
        lon: 7.03299,
        title: "Rifugio Bonatti rest stop",
        desc: "Amazing coffee and views of the Grandes Jorasses massive rock wall and peaks from Rifugio Bonatti.",
        img: "/photos/chamonix_valley.png",
        timestamp: "11:45 AM"
      },
      {
        id: "day5-col-ferret",
        lat: 45.88866,
        lon: 7.07779,
        title: "Grand Col Ferret summit",
        desc: "Highest point of the day. Crossing from Italy into Switzerland under sharp mountain winds.",
        img: "/photos/col_de_la_seigne.png",
        timestamp: "02:30 PM"
      }
    ]
  },
  {
    day: 6,
    title: "Stage 6: La Fouly to Trient",
    distanceKm: 30.0,
    elevationGainM: 1100,
    elevationLossM: 1150,
    gpxFile: "/gpx/tmb-day-6.gpx",
    startName: "La Fouly",
    endName: "Trient",
    restDay: false,
    stats: {
      distance: "18.6 mi",
      gain: "+3,600 ft",
      loss: "-3,750 ft",
      peak: "Col de la Forclaz (5,010 ft)",
      duration: "approx. 7 hours"
    },
    photos: [
      {
        id: "day6-champex",
        lat: 46.02822,
        lon: 7.11940,
        title: "Champex-Lac Alpine Lake",
        desc: "Breathtaking lake known as 'Little Canada', reflecting local pine forests and clear blue skies.",
        img: "/photos/lac_du_combal.png",
        timestamp: "11:00 AM"
      }
    ]
  },
  {
    day: 7,
    title: "Stage 7: Trient to Chamonix",
    distanceKm: 31.0,
    elevationGainM: 1650,
    elevationLossM: 1700,
    gpxFile: "/gpx/tmb-day-7.gpx",
    startName: "Trient",
    endName: "Chamonix Center",
    restDay: false,
    stats: {
      distance: "19.3 mi",
      gain: "+5,400 ft",
      loss: "-5,550 ft",
      peak: "Col de Balme (7,186 ft)",
      duration: "approx. 8 hours"
    },
    photos: [
      {
        id: "day7-balme",
        lat: 46.02451,
        lon: 6.95213,
        title: "Col des Posettes ridge climb",
        desc: "Steep climb up Col des Posettes looking back at Trient, with views of the Chamonix valley in the distance.",
        img: "/photos/col_de_la_seigne.png",
        timestamp: "10:45 AM"
      },
      {
        id: "day7-floria",
        lat: 45.94261,
        lon: 6.87505,
        title: "La Floria café stop",
        desc: "Final tea break at Chalet La Floria, overlooking Chamonix and the massive glaciers of Mont Blanc.",
        img: "/photos/chamonix_valley.png",
        timestamp: "03:15 PM"
      }
    ]
  }
];
