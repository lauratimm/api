const aws = require('aws-sdk');
const jimp = require('jimp');
const mongoose = require('mongoose');
const randomstring = require('randomstring');

require('dotenv').config();

const { eventSchema } = require('../../models/event');

mongoose.Promise = global.Promise;

const s3 = new aws.S3();

async function closeConnections(db) {
  try {
    await db.close();
  } catch (error) {
    console.log(error);
    process.exit(0);
  }

  process.exit(0);
}

const uri = process.env.MONGODB_URI;
const options = {
  useMongoClient: true,
  socketTimeoutMS: 0,
  keepAlive: 2000
};
const db = mongoose.createConnection(uri, options);

db.on('connected', async () => {
  console.log('Connection to DB established successfully');

  const Event = db.model('Event', eventSchema);

  let totalEvents;
  try {
    totalEvents = await Event.count();
  } catch (error) {
    console.log('Events failed to be count');
    console.log(error);
    await closeConnections(db);
  }

  console.log(`Total events: ${totalEvents}`);

  let i = 0;
  let page = 0;
  const pageLimit = 100;
  do {
    let events;
    try {
      events = await Event.find({})
        .skip(page * pageLimit)
        .limit(pageLimit);
    } catch (error) {
      console.log('Teams failed to be found');
      console.log(error);
      await closeConnections(db);
    }

    const updateEvents = [];
    const uploadEventsPosters = [];
    for (let event of events) {
      if (event.poster && !event.poster.includes('icon_guy')) {
        let posterImage;
        try {
          posterImage = await jimp.read(encodeURI(event.poster));
        } catch (err) {
          console.log('Event poster image failed to be read');
          console.log(err);
          await closeConnections(db);
        }

        if (posterImage) {
          const posterExtension = posterImage.getExtension();
          const posterFileName = `${Date.now()}${randomstring.generate({
            length: 5,
            capitalization: 'lowercase'
          })}.${posterExtension}`;

          if (
            posterExtension === 'png' ||
            posterExtension === 'jpeg' ||
            posterExtension === 'jpg' ||
            posterExtension === 'bmp'
          ) {
            const posterMIME = posterImage.getMIME();
            if (posterMIME) {
              event.poster = `https://s3.amazonaws.com/${
                process.env.AWS_S3_BUCKET
              }/events/posters/${posterFileName}`;
              posterImage
                .cover(400, 400)
                .quality(85)
                .getBuffer(posterMIME, async (err, posterBuffer) => {
                  if (err) {
                    console.log('Event poster buffer failed to be read');
                    console.log(err);
                    await closeConnections(db);
                  }

                  uploadEventsPosters.push(
                    s3
                      .putObject({
                        ACL: 'public-read',
                        Body: posterBuffer,
                        Bucket: process.env.AWS_S3_BUCKET,
                        ContentType: posterImage.getMIME(),
                        Key: `events/posters/${posterFileName}`
                      })
                      .promise()
                  );
                });
            } else {
              event.poster = `https://s3.amazonaws.com/${
                process.env.AWS_S3_BUCKET
              }/events/posters/default.png`;
            }
          }
        }
      } else {
        event.poster = `https://s3.amazonaws.com/${
          process.env.AWS_S3_BUCKET
        }/events/posters/default.png`;
      }
      updateEvents.push(event.save());
    }

    try {
      await Promise.all([...updateEvents, ...uploadEventsPosters]);
    } catch (err) {
      console.log(
        `Events failed to be updated.\nData: ${JSON.stringify({
          page,
          i
        })}`
      );
      console.log(err);
      await closeConnections(db);
    }

    page = page + 1;
    i = i + events.length;
    console.log(i);
  } while (i < totalEvents);

  await closeConnections(db);
});

db.on('error', err => {
  console.log('Connection to DB failed ' + err);
  process.exit(0);
});

db.on('disconnected', () => {
  console.log('Connection from DB closed');
});
