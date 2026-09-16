-- Snapshot of the editor's rows taken immediately before they were
-- deleted, once all 46 had been migrated into the library.
-- Restore with: wrangler d1 execute socialmaker-db --remote --file=<this>

INSERT OR REPLACE INTO projects (id,caption,sizes,pv,guides,sel,updated_at) VALUES ('elmaker','ElectionLog is a public record of election problems, written by the people who saw them. Site opens shortly. Bookmark it now: electionlog.org','{"1080x1080":true,"1080x1350":true,"1080x1920":false}','1080x1350',0,'imu2ir5s4',1789560178212);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5s4','elmaker',0,'LONG LINE?','LOG IT.','stack','left','c88239114b2c0d2648e7b7f0245a901e985881fd50f1db800b7dfd96d7928e3b',154,100,0,70,1789467566437);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5s5','elmaker',1,'DOORS LOCKED?','LOG IT.','stack','left','5dfa3291acaf64ce80c77663a9af1e0e8dfef5596297fd5cca8a12226164bc4b',100,50,50,70,1789467576752);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5s6','elmaker',2,'OPENED LATE?','LOG IT.','stack','left','5dfa3291acaf64ce80c77663a9af1e0e8dfef5596297fd5cca8a12226164bc4b',100,50,50,70,1789467583432);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5s7','elmaker',3,'CLOSED EARLY?','LOG IT.','stack','left','5dfa3291acaf64ce80c77663a9af1e0e8dfef5596297fd5cca8a12226164bc4b',100,50,50,70,1789467592123);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5s8','elmaker',4,'SITE MOVED?','LOG IT.','stack','left','585f3c82f6da7be39897cac73e56b0835015630a1f92fa1653e21e473fcbcd19',100,50,50,70,1789467595801);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5s9','elmaker',5,'SIGN GONE?','LOG IT.','stack','left',NULL,100,50,50,70,1789467512153);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sa','elmaker',6,'WRONG ADDRESS?','LOG IT.','stack','left','f1327f1e74a187035a06b3b0e6646f867b6619443c2fef3543c1dd01d2d38886',100,50,50,70,1789467606719);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sb','elmaker',7,'MACHINE DOWN?','LOG IT.','stack','left',NULL,100,50,50,70,1789467512153);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sc','elmaker',8,'SCANNER JAMMED?','LOG IT.','stack','left',NULL,100,50,50,70,1789467512153);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sd','elmaker',9,'PRINTER OUT?','LOG IT.','stack','left',NULL,100,50,50,70,1789467512153);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sf','elmaker',10,'RAN OUT OF BALLOTS?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sg','elmaker',11,'WRONG BALLOT?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sh','elmaker',12,'NO PROVISIONAL OFFERED?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5si','elmaker',13,'BALLOT NEVER CAME?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sj','elmaker',14,'DROP BOX GONE?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sk','elmaker',15,'DROP BOX LOCKED?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sl','elmaker',16,'TURNED AWAY?','LOG IT.','stack','left','cb131c4c592491dfeeb23aa63dfbf6eb875a9033e76a48fe55f4e065cd3f7066',100,50,26.533041930663796,70,1789467655654);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sm','elmaker',17,'TOLD TO COME BACK?','LOG IT.','stack','left','cb131c4c592491dfeeb23aa63dfbf6eb875a9033e76a48fe55f4e065cd3f7066',100,50,50,70,1789467661881);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sn','elmaker',18,'GIVEN BAD INFO?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5so','elmaker',19,'RULES CHANGED
MID-LINE?','LOG IT.','stack','left',NULL,100,50,50,70,1789467671645);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sp','elmaker',20,'NOBODY IN CHARGE?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sq','elmaker',21,'NO RAMP?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sr','elmaker',22,'NO CURBSIDE?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5ss','elmaker',23,'NO INTERPRETER?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5st','elmaker',24,'ACCESSIBLE
BOOTH BROKEN?','LOG IT.','stack','left',NULL,100,50,50,70,1789467688099);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5su','elmaker',25,'BLOCKED AT THE DOOR?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sv','elmaker',26,'CAMERAS ON VOTERS?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sw','elmaker',27,'SHOUTED AT?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sx','elmaker',28,'FOLLOWED TO YOUR CAR?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sy','elmaker',29,'SHORT-STAFFED?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5sz','elmaker',30,'NO TRAINING?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t0','elmaker',31,'TOLD TO STOP?','LOG IT.','stack','left','cb131c4c592491dfeeb23aa63dfbf6eb875a9033e76a48fe55f4e065cd3f7066',100,50,50,70,1789467701908);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t1','elmaker',32,'OBSERVER REMOVED?','LOG IT.','stack','left','7fa9aa80d697cd7e166b77d21e8d07c6e815bedeab6732d18510ab53713ef0e3',100,50,50,70,1789467712214);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t2','elmaker',33,'RULES CHANGED MID-SHIFT?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t3','elmaker',34,'NOTHING WENT WRONG?','LOG THAT TOO.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t4','elmaker',35,'SEE IT?','LOG IT!','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t5','elmaker',36,'SOMEBODY WRITE THIS DOWN.','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t6','elmaker',37,'BE THE PAPER TRAIL.','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t7','elmaker',38,'I''M WRITING THIS DOWN.','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t8','elmaker',39,'YOU SAW THAT, RIGHT?','LOG IT.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5t9','elmaker',40,'NOBODY''S TAKING NOTES?','WE ARE.','stack','left',NULL,100,50,50,70,1789467621156);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5ta','elmaker',41,'THE TRAIL
STARTS
WITH YOU.','LOG IT.','split','center',NULL,100,50,50,70,1789467813670);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5tb','elmaker',42,'PUT IT ON
THE RECORD.','LOG IT.','split','center',NULL,100,50,50,70,1789467797050);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5tc','elmaker',43,'MAKE A
RECORD,','NOT A POST.','split','center',NULL,100,50,50,70,1789467764865);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu2ir5td','elmaker',44,'A POST
DISAPPEARS.','A LOG DOESN''T.','split','center',NULL,100,50,50,70,1789467734771);
INSERT OR REPLACE INTO items (id,project_id,ord,top,bot,variant,align,image_sha,zoom,fx,fy,scrim,updated_at) VALUES ('imu378kus','elmaker',45,'LONG LINE?','LOG IT.','stack','center',NULL,100,50,50,70,1789508643281);
